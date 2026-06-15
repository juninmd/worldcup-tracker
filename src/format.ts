import type { WcEvent, Prediction, Player, TimelineItem } from "./types.ts";
import type { ChampionOdds } from "./champion.ts";
import type { Scorer } from "./scorers.ts";

const FLAGS: Record<string, string> = {
  Brazil: "🇧🇷", Argentina: "🇦🇷", France: "🇫🇷", Spain: "🇪🇸", England: "🏴",
  Portugal: "🇵🇹", Germany: "🇩🇪", Netherlands: "🇳🇱", Morocco: "🇲🇦", USA: "🇺🇸",
  Mexico: "🇲🇽", Paraguay: "🇵🇾", Belgium: "🇧🇪", Egypt: "🇪🇬", Croatia: "🇭🇷",
  Uruguay: "🇺🇾", Japan: "🇯🇵", Norway: "🇳🇴",
};
export const flag = (t: string) => FLAGS[t] ?? "⚽";
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Robust UTC parser: handles "DD/MM/YYYY HH:mm:ss" and ISO-ish strings. */
function parseUtc(ts: string | null): Date | null {
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

function kickoff(e: WcEvent): string {
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

export function fmtPrematch(e: WcEvent, p: Prediction): string {
  const fav = p.pHome >= p.pAway ? e.strHomeTeam : e.strAwayTeam;
  return [
    `🔮 *EXPECTATIVA DO JOGO*`,
    `${flag(e.strHomeTeam)} *${e.strHomeTeam}* x *${e.strAwayTeam}* ${flag(e.strAwayTeam)}`,
    `🕒 ${kickoff(e)}`,
    venueLine(e),
    ctx(e),
    ``,
    `📊 Placar provável: *${p.homeGoals} x ${p.awayGoals}*`,
    `🏆 Vitória ${e.strHomeTeam}: *${pct(p.pHome)}* | Empate: *${pct(p.pDraw)}* | Vitória ${e.strAwayTeam}: *${pct(p.pAway)}*`,
    `💪 Favorito: *${fav}* (Elo ${p.eloHome} x ${p.eloAway})`,
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
    if (pl.strDescriptionEN) lines.push(``, `📝 ${pl.strDescriptionEN.slice(0, 240)}…`);
  }
  return lines.join("\n");
}

export function fmtFulltime(e: WcEvent, p: Prediction, scorers: TimelineItem[]): string {
  const h = Number(e.intHomeScore), a = Number(e.intAwayScore);
  const realRes = h > a ? e.strHomeTeam : h < a ? e.strAwayTeam : "Empate";
  const hitScore = h === p.homeGoals && a === p.awayGoals;
  const predRes = p.pHome >= p.pAway && p.pHome >= p.pDraw ? e.strHomeTeam
    : p.pAway >= p.pDraw ? e.strAwayTeam : "Empate";
  const hitWinner = predRes === realRes;
  const goals = scorers.length
    ? scorers.map((g) => `   ${g.intTime}' ${g.strPlayer} (${g.strTeam})${g.strAssist ? ` 🅰️ ${g.strAssist}` : ""}`).join("\n")
    : "   —";
  return [
    `⏱ *FIM DE JOGO*`,
    `${flag(e.strHomeTeam)} *${e.strHomeTeam} ${h} x ${a} ${e.strAwayTeam}* ${flag(e.strAwayTeam)}`,
    `🕒 ${kickoff(e)}`,
    venueLine(e),
    ctx(e),
    e.intSpectators ? `👥 Público: ${Number(e.intSpectators).toLocaleString("pt-BR")}` : "",
    ``,
    `🎯 *Expectativa x Realidade*`,
    `Previsto: ${p.homeGoals} x ${p.awayGoals} (${predRes})`,
    `Real:     ${h} x ${a} (${realRes})`,
    `Placar exato: ${hitScore ? "✅ acertou" : "❌ errou"} | Resultado: ${hitWinner ? "✅ acertou" : "❌ errou"}`,
    ``,
    `⚽️ *Gols:*`,
    goals,
    e.strVideo ? `\n📺 [Melhores momentos](${e.strVideo})` : "",
  ].filter(Boolean).join("\n");
}

export function fmtDailyMenu(
  date: string, today: WcEvent[], preds: Map<string, Prediction>,
  recent: WcEvent[], champ: ChampionOdds[], scorers: Scorer[] = [],
): string {
  const day = today.length
    ? today.map((e) => {
        const p = preds.get(e.idEvent);
        const tip = p ? ` _(prev. ${p.homeGoals}x${p.awayGoals})_` : "";
        return `• ${kickoff(e)} ${flag(e.strHomeTeam)} ${e.strHomeTeam} x ${e.strAwayTeam} ${flag(e.strAwayTeam)}${tip}`;
      }).join("\n")
    : "_Sem jogos hoje._";
  const last = recent.length
    ? recent.slice(0, 6).map((e) =>
        `• ${e.strHomeTeam} ${e.intHomeScore}-${e.intAwayScore} ${e.strAwayTeam}`).join("\n")
    : "_Sem resultados ainda._";
  const odds = champ.slice(0, 6)
    .map((c, i) => `${i + 1}. ${flag(c.team)} ${c.team} — *${pct(c.prob)}*`).join("\n");
  const art = scorers.length
    ? scorers.slice(0, 5).map((s, i) =>
        `${i + 1}. ${flag(s.team)} ${s.player} (${s.team}) — *${s.goals}* ⚽️`).join("\n")
    : "_Sem gols ainda._";
  return [
    `📅 *MENU DO DIA — ${date}*`,
    `🏟 *Copa do Mundo 2026*`,
    ``,
    `*Jogos de hoje:*`, day, ``,
    `*Últimos resultados:*`, last, ``,
    `⚽️ *Artilheiros:*`, art, ``,
    `🏆 *Favoritos ao título (Elo):*`, odds,
  ].join("\n");
}
