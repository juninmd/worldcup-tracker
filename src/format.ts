import type { WcEvent, Prediction, Player, TimelineItem } from "./types.ts";
import type { ChampionOdds } from "./champion.ts";
import type { ProjectedMatch } from "./tournament.ts";
import type { Scorer } from "./scorers.ts";
import { canonicalTeam, FIFA_RANK_AS_OF, MODEL_VERSION } from "./elo.ts";

const FLAGS: Record<string, string> = {
  Brazil: "🇧🇷", Argentina: "🇦🇷", France: "🇫🇷", Spain: "🇪🇸", England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  Portugal: "🇵🇹", Germany: "🇩🇪", Netherlands: "🇳🇱", Morocco: "🇲🇦", USA: "🇺🇸",
  Mexico: "🇲🇽", Paraguay: "🇵🇾", Belgium: "🇧🇪", Egypt: "🇪🇬", Croatia: "🇭🇷",
  Uruguay: "🇺🇾", Japan: "🇯🇵", Norway: "🇳🇴",
  // Rest of the WC2026 field + likely qualifiers (feed names → emoji flag).
  Iran: "🇮🇷", "New Zealand": "🇳🇿", Iraq: "🇮🇶", Senegal: "🇸🇳", Canada: "🇨🇦",
  Italy: "🇮🇹", Switzerland: "🇨🇭", Denmark: "🇩🇰", Poland: "🇵🇱", Serbia: "🇷🇸",
  Sweden: "🇸🇪", Austria: "🇦🇹", Ukraine: "🇺🇦", Turkey: "🇹🇷", Türkiye: "🇹🇷",
  "Czech Republic": "🇨🇿", Czechia: "🇨🇿", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", Wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  Ghana: "🇬🇭", Nigeria: "🇳🇬", Cameroon: "🇨🇲", "Ivory Coast": "🇨🇮", "Côte d'Ivoire": "🇨🇮",
  Algeria: "🇩🇿", Tunisia: "🇹🇳", "South Africa": "🇿🇦", "Cape Verde": "🇨🇻",
  "South Korea": "🇰🇷", "Korea Republic": "🇰🇷", "Saudi Arabia": "🇸🇦", Qatar: "🇶🇦",
  Australia: "🇦🇺", Jordan: "🇯🇴", Uzbekistan: "🇺🇿", Colombia: "🇨🇴", Chile: "🇨🇱",
  Peru: "🇵🇪", Ecuador: "🇪🇨", Venezuela: "🇻🇪", Bolivia: "🇧🇴", "Costa Rica": "🇨🇷",
  Panama: "🇵🇦", Jamaica: "🇯🇲", Honduras: "🇭🇳", Haiti: "🇭🇹", "Curaçao": "🇨🇼",
  Curacao: "🇨🇼", "Bosnia and Herzegovina": "🇧🇦", "DR Congo": "🇨🇩",
};
export const flag = (t: string) => FLAGS[t] ?? "⚽";
export const pct = (p: number) => `${Math.round(p * 100)}%`;

// Next FIFA World Cup after 2026: 2030 — centenary opener on 8 Jun 2030 (Uruguay),
// main tournament in Spain/Portugal/Morocco. Used for the post-tournament countdown.
const NEXT_WORLD_CUP = { label: "Copa do Mundo 2030 🇪🇸🇵🇹🇲🇦", firstMatchUtc: "2030-06-08T00:00:00Z" };
export function daysToNextWorldCup(from = new Date()): number {
  return Math.max(0, Math.ceil((new Date(NEXT_WORLD_CUP.firstMatchUtc).getTime() - from.getTime()) / 86_400_000));
}
export function nextWorldCupLine(from = new Date()): string {
  return `⏳ *Faltam ${daysToNextWorldCup(from).toLocaleString("pt-BR")} dias* para a ${NEXT_WORLD_CUP.label} — 1º jogo em 08/06/2030.`;
}

// Unicode probability bar: `pHome | pDraw | pAway` visualised in 30 chars total.
function oddsBar(pHome: number, pDraw: number, pAway: number): string {
  const W = 20;
  const fH = Math.round(pHome * W), fD = Math.round(pDraw * W), fA = W - fH - fD;
  return `🏠 ${("█".repeat(Math.max(0, fH)) + "░".repeat(Math.max(0, W - fH))).slice(0, W)} ${pct(pHome)}`
    + `\n🤝 ${"█".repeat(Math.max(0, fD))}${"░".repeat(Math.max(0, W - fD))} ${pct(pDraw)}`
    + `\n✈️ ${"█".repeat(Math.max(0, fA))}${"░".repeat(Math.max(0, W - fA))} ${pct(pAway)}`;
}

/** Robust UTC parser: handles "DD/MM/YYYY HH:mm:ss" and ISO-ish strings. */
export function parseUtc(ts: string | null): Date | null {
  if (!ts) return null;
  const m = ts.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, dd, mm, yy, hh, mi, ss] = m;
    return new Date(Date.UTC(+yy!, +mm! - 1, +dd!, +hh!, +mi!, +ss!));
  }
  const d = new Date(ts.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
}

const BRT = (d: Date, withTime = true) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });

export function kickoff(e: WcEvent): string {
  const d = parseUtc(e.strTimestamp);
  return d ? `${BRT(d)} (BRT)` : e.dateEvent;
}

/** Wall-clock time a goal happened: kickoff + match minute, in BRT. */
function goalClock(e: WcEvent, minute: string): string {
  const d = parseUtc(e.strTimestamp);
  const min = Number(minute);
  if (!d || Number.isNaN(min)) return "";
  return BRT(new Date(d.getTime() + min * 60_000));
}

const googleLink = (name: string) =>
  `[${name}](https://www.google.com/search?q=${encodeURIComponent(name + " jogador futebol")})`;

function venueLine(e: WcEvent): string {
  const parts = [e.strVenue, e.strCity, e.strCountry].filter(Boolean);
  return parts.length ? `🏟 ${parts.join(" · ")}` : "";
}

function ctx(e: WcEvent): string {
  const bits: string[] = [];
  if (e.strGroup) bits.push(`Grupo ${e.strGroup}`);
  if (e.intRound) bits.push(`Rodada ${e.intRound}`);
  return bits.length ? `🏁 ${bits.join(" · ")}` : "";
}

export function fmtPrematch(
  e: WcEvent,
  p: Prediction,
  absences?: { home: { name: string; weight: number }[]; away: { name: string; weight: number }[] },
): string {
  const fav = p.pHome >= p.pAway ? e.strHomeTeam : e.strAwayTeam;
  const rankLine = (p.fifaRankHome && p.fifaRankAway)
    ? `🌍 Ranking FIFA (${FIFA_RANK_AS_OF}): ${flag(e.strHomeTeam)} *#${p.fifaRankHome}* ${e.strHomeTeam} vs ${e.strAwayTeam} *#${p.fifaRankAway}* ${flag(e.strAwayTeam)}`
    : p.fifaRankHome
    ? `🌍 Ranking FIFA (${FIFA_RANK_AS_OF}): ${e.strHomeTeam} *#${p.fifaRankHome}*`
    : p.fifaRankAway
    ? `🌍 Ranking FIFA (${FIFA_RANK_AS_OF}): ${e.strAwayTeam} *#${p.fifaRankAway}*`
    : "";
  const eloDiff = Math.abs(p.strengthHome - p.strengthAway);
  const dominance = eloDiff > 150 ? "superioridade clara" : eloDiff > 80 ? "ligeiro favoritismo" : "jogo equilibrado";
  const absLines: string[] = [];
  if (absences?.home.length) {
    absLines.push(`⚠️ Ausentes ${flag(e.strHomeTeam)} *${e.strHomeTeam}*: ${absences.home.map(a => a.name).join(", ")}`);
  }
  if (absences?.away.length) {
    absLines.push(`⚠️ Ausentes ${flag(e.strAwayTeam)} *${e.strAwayTeam}*: ${absences.away.map(a => a.name).join(", ")}`);
  }
  return [
    `🔮 *EXPECTATIVA DO JOGO*`,
    `${flag(e.strHomeTeam)} *${e.strHomeTeam}* x *${e.strAwayTeam}* ${flag(e.strAwayTeam)}`,
    `🕒 ${kickoff(e)}`,
    venueLine(e),
    ctx(e),
    rankLine,
    ...absLines,
    ``,
    `📊 Placar provável: *${p.homeGoals} x ${p.awayGoals}*  _(${dominance})_`,
    ``,
    oddsBar(p.pHome, p.pDraw, p.pAway),
    ``,
    `💪 Favorito: *${fav}*`,
    `🧠 Modelo interno ${MODEL_VERSION}: Elo ${p.eloHome} vs ${p.eloAway} · índice manual de elenco +${p.playerQualityHome} vs +${p.playerQualityAway} · força ${p.strengthHome} vs ${p.strengthAway}`,
  ].filter(Boolean).join("\n");
}

const GOAL_TYPE: Record<string, string> = {
  Penalty: "Pênalti 🎯", "Own Goal": "Gol contra 🙃", Header: "De cabeça 🤕",
  "Free-kick": "Cobrança de falta ⚡", "Free Kick": "Cobrança de falta ⚡",
};

function ageFrom(dateBorn: string | null): number | null {
  if (!dateBorn) return null;
  const b = new Date(dateBorn);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export function fmtGoalCaption(g: TimelineItem, e: WcEvent, pl: Player | null, score: string): string {
  const team = g.strTeam ?? "";
  const type = GOAL_TYPE[g.strTimelineDetail ?? ""];
  const clock = goalClock(e, g.intTime);
  const local = e.strVenue ? `${e.strVenue}${e.strCity ? ` — ${e.strCity}` : ""}` : e.strCountry;
  const lines = [
    `⚽️ *GOOOL!* ${flag(team)} *${team}* — ${g.intTime}'${type ? ` _(${type})_` : ""}`,
    `📊 ${flag(e.strHomeTeam)} *${e.strHomeTeam} ${score} ${e.strAwayTeam}* ${flag(e.strAwayTeam)}`,
    clock ? `🕒 ${clock} (BRT) · 📅 ${e.dateEvent}` : `📅 ${e.dateEvent}`,
    local ? `🏟 ${local}` : "",
    ``,
    `👤 *${g.strPlayer ?? "?"}*  🔎 ${g.strPlayer ? googleLink(g.strPlayer) : ""}`,
  ].filter(Boolean);
  if (g.strAssist) lines.push(`🅰️ Assistência: *${g.strAssist}* (🔎 ${googleLink(g.strAssist)})`);
  if (pl) {
    const meta: string[] = [];
    if (pl.strNumber) meta.push(`👕 #${pl.strNumber}`);
    if (pl.strPosition) meta.push(`📍 ${pl.strPosition}`);
    const age = ageFrom(pl.dateBorn);
    if (age) meta.push(`🎂 ${age} anos`);
    if (pl.dateBorn) meta.push(`📆 ${pl.dateBorn}`);
    if (meta.length) lines.push(meta.join("  ·  "));
    if (pl.strTeam) lines.push(`🏟 Clube: ${pl.strTeam}`);
    if (pl.strNationality) lines.push(`🌍 ${pl.strNationality}`);
    if (pl.intInternationalCaps || pl.intCareerGoals) {
      const career: string[] = [];
      if (pl.intInternationalCaps) career.push(`🎽 ${pl.intInternationalCaps} jogos pela seleção`);
      if (pl.intCareerGoals) career.push(`⚽️ ${pl.intCareerGoals} gols na carreira`);
      lines.push(career.join("  ·  "));
    }
    if (pl.strDescriptionEN) lines.push(``, `📝 ${pl.strDescriptionEN.slice(0, 240)}…`);
  }
  if (g.strPlayer) {
    lines.push(
      ``,
      `🎥 [Vídeo do gol (buscar)](${youtubeSearchLink(`${g.strPlayer} gol ${team} ${e.strHomeTeam} x ${e.strAwayTeam} Copa do Mundo 2026`)})`,
      `🎬 [Vídeos do jogador — FIFA (buscar)](${youtubeSearchLink(`${g.strPlayer} FIFA World Cup 2026`)})`,
    );
  }
  return lines.join("\n");
}

// A win is a "zebra" (upset) when the winner was given under 35% by the model —
// used both to flag it in the fulltime message and to decide whether to trigger
// an automatic post-match AI analysis (see engine.ts postFulltime).
const UPSET_THRESHOLD = 0.35;

export function isUpset(p: Prediction, homeGoals: number, awayGoals: number): boolean {
  return (homeGoals > awayGoals && p.pHome < UPSET_THRESHOLD) || (awayGoals > homeGoals && p.pAway < UPSET_THRESHOLD);
}

/** YouTube search deep-link. FIFA's public match API exposes no goal-clip or
 *  player-highlight video URLs (verified empty across every squad, incl. stars
 *  like Messi/Mbappé/Neymar) — this is the best one-tap path to real footage. */
export function youtubeSearchLink(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function fmtFulltime(e: WcEvent, p: Prediction, scorers: TimelineItem[]): string {
  const h = Number(e.intHomeScore), a = Number(e.intAwayScore);
  const status = (e.strStatus ?? "").toUpperCase();
  const decider = status === "AET" ? " _(após prorrogação)_" : status === "PEN" ? " _(nos pênaltis)_" : "";
  const realRes = h > a ? e.strHomeTeam : h < a ? e.strAwayTeam : "Empate";
  const hitScore = h === p.homeGoals && a === p.awayGoals;
  const predRes = p.pHome >= p.pAway && p.pHome >= p.pDraw ? e.strHomeTeam
    : p.pAway >= p.pDraw ? e.strAwayTeam : "Empate";
  const hitWinner = predRes === realRes;
  const goals = scorers.length
    ? scorers.map((g) => `   ${g.intTime}' ${g.strPlayer ?? "?"} (${g.strTeam ?? "?"})${g.strAssist ? ` 🅰️ ${g.strAssist}` : ""}`).join("\n")
    : "   —";
  const totalGoals = h + a;
  const rankLine = (p.fifaRankHome && p.fifaRankAway)
    ? `🌍 FIFA #${p.fifaRankHome} ${e.strHomeTeam} vs #${p.fifaRankAway} ${e.strAwayTeam}`
    : "";
  const underdog = h > a ? { team: e.strHomeTeam, chance: p.pHome } : { team: e.strAwayTeam, chance: p.pAway };
  const upset = isUpset(p, h, a)
    ? `⚡ *ZEBRA!* ${underdog.team} venceu com apenas ${pct(underdog.chance)} de chance no modelo.` : "";
  const highlightsQuery = `${e.strHomeTeam} x ${e.strAwayTeam} melhores momentos Copa do Mundo 2026`;
  return [
    `⏱ *FIM DE JOGO*`,
    `${flag(e.strHomeTeam)} *${e.strHomeTeam} ${h} x ${a} ${e.strAwayTeam}* ${flag(e.strAwayTeam)}${decider}`,
    `🕒 ${kickoff(e)}`,
    venueLine(e),
    ctx(e),
    rankLine,
    e.intSpectators ? `👥 Público: ${Number(e.intSpectators).toLocaleString("pt-BR")}` : "",
    upset,
    ``,
    `🎯 *Expectativa x Realidade*`,
    `Previsto: ${p.homeGoals}×${p.awayGoals} (${predRes}) · odds ${pct(p.pHome)}/${pct(p.pDraw)}/${pct(p.pAway)}`,
    `Real:     ${h}×${a} (${realRes}) · ${totalGoals} gol${totalGoals !== 1 ? "s" : ""}`,
    `Placar exato: ${hitScore ? "✅ acertou" : "❌ errou"} | Resultado: ${hitWinner ? "✅ acertou" : "❌ errou"}`,
    ``,
    `⚽️ *Gols:*`,
    goals,
    `\n📺 [Melhores momentos (buscar)](${youtubeSearchLink(highlightsQuery)})`,
  ].filter(Boolean).join("\n");
}

const FINISHED_STATUS = new Set(["FT", "AET", "PEN", "MATCH FINISHED"]);
const eventMs = (e: WcEvent): number => parseUtc(e.strTimestamp)?.getTime() ?? new Date(e.dateEvent).getTime();

/** Post-World-Cup "keep following the Seleção" block: Brazil's upcoming friendlies
 *  and its latest results, from the FIFA calendar (non-WC competitions). */
export function fmtBrazilFriendlies(events: WcEvent[], now = new Date()): string | null {
  if (!events.length) return null;
  const nowMs = now.getTime();
  const finished = (e: WcEvent) => FINISHED_STATUS.has((e.strStatus ?? "").toUpperCase());
  const upcoming = events
    .filter((e) => !finished(e) && eventMs(e) >= nowMs - 3 * 3_600_000)
    .sort((a, b) => eventMs(a) - eventMs(b))
    .slice(0, 4);
  const recent = events.filter(finished).sort((a, b) => eventMs(b) - eventMs(a)).slice(0, 3);
  if (!upcoming.length && !recent.length) return null;
  const lines = [`🇧🇷 *AGENDA DA SELEÇÃO — amistosos e outros jogos*`];
  if (upcoming.length) {
    lines.push(`*Próximos:*`);
    for (const e of upcoming) {
      lines.push(`• ${kickoff(e)} ${flag(e.strHomeTeam)} ${e.strHomeTeam} x ${e.strAwayTeam} ${flag(e.strAwayTeam)}`);
    }
  }
  if (recent.length) {
    lines.push(`*Últimos resultados:*`);
    for (const e of recent) {
      lines.push(`• ${flag(e.strHomeTeam)} ${e.strHomeTeam} ${e.intHomeScore ?? "-"}–${e.intAwayScore ?? "-"} ${e.strAwayTeam} ${flag(e.strAwayTeam)}`);
    }
  }
  return lines.join("\n");
}

export function fmtDailyMenu(
  date: string, today: WcEvent[], preds: Map<string, Prediction>,
  recent: WcEvent[], champ: ChampionOdds[], scorers: Scorer[] = [],
  brazilPath: ProjectedMatch[] = [], extraSections: (string | null)[] = [],
): string {
  const day = today.length
    ? today.map((e) => {
        const p = preds.get(e.idEvent);
        const tip = p ? ` _(prev. ${p.homeGoals}×${p.awayGoals})_` : "";
        const rankInfo = p?.fifaRankHome && p?.fifaRankAway
          ? ` [#${p.fifaRankHome} vs #${p.fifaRankAway}]` : "";
        return `• ${kickoff(e)} ${flag(e.strHomeTeam)} ${e.strHomeTeam} x ${e.strAwayTeam} ${flag(e.strAwayTeam)}${tip}${rankInfo}`;
      }).join("\n")
    : "_Sem jogos hoje._";
  const last = recent.length
    ? recent.slice(0, 6).map((e) =>
        `• ${flag(e.strHomeTeam)} ${e.strHomeTeam} ${e.intHomeScore}–${e.intAwayScore} ${e.strAwayTeam} ${flag(e.strAwayTeam)}`).join("\n")
    : "_Sem resultados ainda._";
  const odds = champ.slice(0, 6)
    .map((c, i) => `${i + 1}. ${flag(c.team)} ${c.team} — *${pct(c.prob)}* (força ${c.strength})`).join("\n");
  const art = scorers.length
    ? scorers.slice(0, 5).map((s, i) =>
        `${i + 1}. ${flag(s.team)} ${s.player} (${s.team}) — *${s.goals}* ⚽️`).join("\n")
    : "_Sem gols ainda._";

  const lastBrazilMatch = brazilPath.at(-1);
  const brazilEliminated = lastBrazilMatch?.real && canonicalTeam(lastBrazilMatch.winner) !== "Brazil";
  const brazilChampion = lastBrazilMatch?.real && lastBrazilMatch.round === "Final" && canonicalTeam(lastBrazilMatch.winner) === "Brazil";
  const brazilHistory = () => brazilPath.map((m) => {
    const home = canonicalTeam(m.home) === "Brazil";
    const opponent = home ? m.away : m.home;
    const brazilGoals = home ? m.prediction.homeGoals : m.prediction.awayGoals;
    const opponentGoals = home ? m.prediction.awayGoals : m.prediction.homeGoals;
    return `• *${m.round}*: Brasil ${brazilGoals}×${opponentGoals} ${flag(opponent)} ${opponent} — ${canonicalTeam(m.winner) === "Brazil" ? "✅ avançou" : "❌ eliminado"}`;
  });
  const futureBrazilPath = brazilPath.filter((match) => !match.real);
  const brazilSection = brazilPath.length
    ? brazilEliminated || brazilChampion
      ? [
        brazilChampion ? `🇧🇷 *BRASIL CAMPEÃO*` : `🇧🇷 *CAMPANHA DO BRASIL ENCERRADA*`,
        ...brazilHistory(),
      ].join("\n")
      : [
        `🇧🇷 *PRÓXIMOS PASSOS DO BRASIL*`,
        ...futureBrazilPath.slice(0, 3).map((m) => {
          const isBrazilHome = canonicalTeam(m.home) === "Brazil";
          const opponent = isBrazilHome ? m.away : m.home;
          const pBrazil = isBrazilHome ? m.prediction.pHome : m.prediction.pAway;
          const rankOp = isBrazilHome ? m.prediction.fifaRankAway : m.prediction.fifaRankHome;
          const rankStr = rankOp ? ` (FIFA #${rankOp})` : "";
          return `• *${m.round}*: vs ${flag(opponent)} ${opponent}${rankStr} — ${pct(pBrazil)} Brasil vence`;
        }),
      ].join("\n")
    : "";

  return [
    `📅 *MENU DO DIA — ${date}*`,
    `🏟 *Copa do Mundo 2026*`,
    ``,
    `*Jogos de hoje:*`, day, ``,
    brazilSection, brazilSection ? `` : null,
    `*Últimos resultados:*`, last, ``,
    `⚽️ *Artilheiros:*`, art, ``,
    `🏆 *Favoritos ao título (Monte Carlo + chave atual):*`, odds,
    ...extraSections.flatMap((s) => (s ? ["", s] : [])),
  ].filter((x) => x !== null).join("\n");
}
