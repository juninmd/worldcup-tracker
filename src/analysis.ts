import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { WcEvent, EventStat, TimelineItem, CardEvent, IntensityBucket } from "./types.ts";
import { eventStats, timeline, cardEvents, matchIntensity, lineup, substitutionEvents, varIncidents, matchIncidents, shotEvents, possessionStat, mergedSeasonEvents, isFinished, type SubstitutionItem, type VarIncident, type MatchIncident, type ShotEvent } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { matchIntensityChartUrl } from "./charts.ts";
import { trainRatings } from "./elo.ts";
import { expectedGoalsFromMatrix, scoreMatrix } from "./predict.ts";

// Runs against the cluster's own LiteLLM gateway (OpenAI-compatible), using the
// same free backends (NVIDIA NIM/Gemini) the rest of the cluster's AI apps share.
const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL ?? "https://litellm.antonio-code.duckdns.org/v1";
const LITELLM_MODEL = process.env.LITELLM_MODEL ?? "cloud/auto";
const LITELLM_API_KEY = process.env.LITELLM_API_KEY || "litellm";

const PlayerNote = z.object({
  jogador: z.string(),
  time: z.string(),
  motivo: z.string(),
});
type PlayerNoteValue = z.infer<typeof PlayerNote>;

const MatchAnalysisSchema = z.object({
  resumo: z.string().describe("Resumo objetivo da partida em português do Brasil, 2 a 4 frases."),
  acontecimentosChave: z.array(z.string()).min(3).max(8).describe("De 3 a 8 acontecimentos decisivos da partida, usando apenas gols, cartões, substituições, VAR e estatísticas fornecidas."),
  leituraEstatistica: z.array(z.string()).min(3).max(8).describe("De 3 a 8 leituras comparativas das estatísticas oficiais: domínio, eficiência, disciplina, volume ou equilíbrio."),
  placarJusto: z.object({
    veredito: z.enum(["justo", "injusto", "parcialmente justo"]),
    motivo: z.string(),
  }).describe("Avaliação direta se o placar final foi justo diante das estatísticas e acontecimentos."),
  azar: z.object({
    time: z.string().describe("Time que mais sofreu com azar/ineficiência, ou 'Nenhum' se não houver evidência."),
    motivo: z.string(),
  }).describe("Avaliação de azar com base em volume, gols sofridos, cartões, chances e eficiência; não inventar lances."),
  golsEsperadosIA: z.object({
    casa: z.number().describe("Gols esperados estimados pela IA para o time da casa, com base nos dados pós-jogo fornecidos."),
    fora: z.number().describe("Gols esperados estimados pela IA para o time visitante, com base nos dados pós-jogo fornecidos."),
    motivo: z.string(),
  }).describe("Estimativa pós-jogo da IA para gols esperados, usando chutes, chances claras, xG da timeline, incidentes e estatísticas fornecidas. Não copiar a expectativa pré-jogo do modelo."),
  melhorEmCampo: PlayerNote.describe("O jogador em campo com melhor desempenho na partida."),
  destaques: z.array(PlayerNote).min(1).max(5).describe("De 1 a 5 jogadores que jogaram bem, de ambos os times quando fizer sentido."),
  mereciaGanhar: z.object({
    time: z.string().describe("Nome do time (ou 'Empate' se o resultado refletiu o jogo)."),
    motivo: z.string(),
  }).describe("Avaliação de qual time merecia vencer com base no desempenho, não apenas no placar."),
  maisErros: z.array(PlayerNote).min(1).max(4).describe("De 1 a 4 jogadores que mais erraram ou pesaram negativamente no jogo."),
});

export type MatchAnalysis = z.infer<typeof MatchAnalysisSchema>;

export interface MatchDigest {
  event: WcEvent;
  stats: EventStat[];
  goals: TimelineItem[];
  cards: CardEvent[];
  substitutions: SubstitutionItem[];
  varIncidents: VarIncident[];
  incidents: MatchIncident[];
  shots: ShotEvent[];
  clearChances: ShotEvent[];
  xg: {
    modelHome: number | null;
    modelAway: number | null;
    timelineHome: number;
    timelineAway: number;
    realHome: number | null;
    realAway: number | null;
  };
  unavailableStats: string[];
  intensity: IntensityBucket[];
  homeLineup: string[];
  awayLineup: string[];
}

async function modelExpectedGoals(e: WcEvent): Promise<{ home: number; away: number } | null> {
  const all = await mergedSeasonEvents();
  const before = all.filter((x) =>
    isFinished(x)
    && x.idEvent !== e.idEvent
    && (x.strTimestamp ?? x.dateEvent).localeCompare(e.strTimestamp ?? e.dateEvent) < 0);
  const table = trainRatings(before);
  return expectedGoalsFromMatrix(scoreMatrix(table, e.strHomeTeam, e.strAwayTeam, before, true));
}

export async function buildMatchDigest(e: WcEvent): Promise<MatchDigest> {
  const [baseStats, possession, goals, cards, substitutions, varReviews, incidents, shots, xgModel, intensity, players] = await Promise.all([
    eventStats(e.idEvent),
    possessionStat(e.idEvent),
    timeline(e.idEvent),
    cardEvents(e.idEvent),
    substitutionEvents(e.idEvent),
    varIncidents(e.idEvent),
    matchIncidents(e.idEvent),
    shotEvents(e.idEvent),
    modelExpectedGoals(e),
    matchIntensity(e.idEvent),
    lineup(e.idEvent),
  ]);
  const starters = players.filter((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
  const sumXg = (team: string) => Math.round(shots.filter((s) => s.team === team).reduce((sum, s) => sum + s.xg, 0) * 100) / 100;
  const stats = possession ? [...baseStats, possession] : baseStats;
  return {
    event: e,
    stats,
    goals,
    cards,
    substitutions,
    varIncidents: varReviews,
    incidents,
    shots,
    clearChances: shots.filter((s) => s.clearChance && s.outcome !== "goal"),
    xg: {
      modelHome: xgModel?.home ?? null,
      modelAway: xgModel?.away ?? null,
      timelineHome: sumXg(e.strHomeTeam),
      timelineAway: sumXg(e.strAwayTeam),
      realHome: e.intHomeScore === null ? null : Number(e.intHomeScore),
      realAway: e.intAwayScore === null ? null : Number(e.intAwayScore),
    },
    unavailableStats: [
      ...(possession ? [] : ["Posse de bola: indisponível/nullable no feed FIFA live para este jogo"]),
      "Passes certos/errados: não expostos no feed FIFA usado pelo app",
    ],
    intensity,
    homeLineup: starters.filter((p) => p.strHome === "Yes").map((p) => p.strPlayer),
    awayLineup: starters.filter((p) => p.strHome === "No").map((p) => p.strPlayer),
  };
}

export function digestPrompt(d: MatchDigest): string {
  const e = d.event;
  const lines = [
    `Partida: ${e.strHomeTeam} ${e.intHomeScore ?? "?"} x ${e.intAwayScore ?? "?"} ${e.strAwayTeam}`,
    e.strStage ? `Fase: ${e.strStage}` : e.strGroup ? `Grupo: ${e.strGroup}` : "",
    e.strVenue ? `Local: ${e.strVenue}${e.strCity ? `, ${e.strCity}` : ""}` : "",
    e.intSpectators ? `Público: ${e.intSpectators}` : "",
    e.intHomePenaltyScore || e.intAwayPenaltyScore ? `Pênaltis: ${e.intHomePenaltyScore ?? "-"} x ${e.intAwayPenaltyScore ?? "-"}` : "",
    ``,
    `Estatísticas oficiais (casa / fora):`,
    ...d.stats.map((s) => `- ${s.strStat}: ${s.intHome ?? "-"} / ${s.intAway ?? "-"}`),
    ...d.unavailableStats.map((s) => `- ${s}`),
    ``,
    `Gols esperados (casa / fora):`,
    `- Expectativa pré-jogo do modelo: ${d.xg.modelHome ?? "indisponível"} / ${d.xg.modelAway ?? "indisponível"}`,
    `- xG estimado pela timeline de chutes: ${d.xg.timelineHome} / ${d.xg.timelineAway}`,
    `- Gols reais: ${d.xg.realHome ?? "?"} / ${d.xg.realAway ?? "?"}`,
    ``,
    `Chutes e chances claras inferidas:`,
    ...(d.clearChances.length
      ? d.clearChances.map((s) => `- ${s.minute}' ${s.player ?? "?"} (${s.team ?? "?"}): ${s.detail} xG~${s.xg}`)
      : ["- nenhuma chance clara sem gol inferida por posição/defesa/pênalti"]),
    ``,
    `Gols:`,
    ...(d.goals.length
      ? d.goals.map((g) => `- ${g.intTime}' ${g.strPlayer ?? "?"} (${g.strTeam ?? "?"})${g.strTimelineDetail ? ` [${g.strTimelineDetail}]` : ""}`)
      : ["- nenhum gol registrado"]),
    ``,
    `Cartões:`,
    ...(d.cards.length
      ? d.cards.map((c) => `- ${c.intTime}' ${c.strPlayer ?? "?"} (${c.strTeam ?? "?"}) — ${c.cardType === "red" ? "vermelho" : "amarelo"}`)
      : ["- nenhum cartão registrado"]),
    ``,
    `Substituições:`,
    ...(d.substitutions.length
      ? d.substitutions.map((s) => `- ${s.minute}' ${s.playerIn ?? "?"} entrou, ${s.playerOut ?? "?"} saiu (${s.team ?? "?"})`)
      : ["- nenhuma substituição registrada"]),
    ``,
    `VAR:`,
    ...(d.varIncidents.length
      ? d.varIncidents.map((v) => `- ${v.minute}' ${v.team ?? "?"}: ${v.comment ?? "Revisão do VAR"}`)
      : ["- nenhuma revisão de VAR registrada"]),
    ``,
    `Incidentes decisivos sem gol:`,
    ...(d.incidents.length
      ? d.incidents.map((i) => `- ${i.minute}' ${i.team ?? "?"}: ${i.detail}`)
      : ["- nenhum incidente decisivo sem gol registrado"]),
    ``,
    `Intensidade por período (eventos ponderáveis de timeline: finalizações, escanteios, faltas, cartões e gols; casa / fora):`,
    ...d.intensity.map((b) => `- ${b.label}: ${b.home} / ${b.away}`),
    ``,
    `Obrigatório na resposta: use todas as estatísticas oficiais e derivadas listadas acima, todos os gols/cartões/substituições/VAR/incidentes sem gol/chances claras listados acima, compare xG pré-jogo do modelo, xG estimado pela timeline, xG estimado pela IA e gols reais; diga se o placar foi justo, se houve azar/ineficiência e quem merecia ganhar.`,
  ];
  if (d.homeLineup.length) lines.push(``, `Titulares ${e.strHomeTeam}: ${d.homeLineup.join(", ")}`);
  if (d.awayLineup.length) lines.push(``, `Titulares ${e.strAwayTeam}: ${d.awayLineup.join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

const SYSTEM_PROMPT = [
  "Você é um analista técnico de futebol imparcial, escrevendo em português do Brasil.",
  "Baseie-se estritamente nos dados oficiais fornecidos (placar, estatísticas, gols esperados, chutes, chances claras inferidas, gols, cartões, substituições, VAR, incidentes sem gol, intensidade por período e titulares).",
  "Não invente jogadores, eventos ou estatísticas que não estejam nos dados.",
  "Nos campos de jogador, use somente jogadores citados nos gols, cartões, substituições ou titulares.",
  "No campo time de cada jogador, escreva exatamente o nome do time da partida, nunca siglas, minutos, períodos ou posições.",
  "Se os titulares não forem informados, cite apenas jogadores que aparecem nos gols, cartões ou substituições.",
  "Em acontecimentosChave, escreva lances concretos com minuto, jogador/time e impacto; nunca use rótulos genéricos como 'Gols', 'Cartões' ou 'Estatísticas oficiais'.",
  "A resposta deve cobrir todas as estatísticas e acontecimentos oficiais fornecidos, sem omitir gols ou cartões.",
  "Em golsEsperadosIA, estime xG pós-jogo pela qualidade das chances; não copie a expectativa pré-jogo do modelo.",
  "Separe claramente placar justo, azar/ineficiência e merecimento de vitória.",
  "Seja direto e específico, evitando clichês genéricos.",
].join(" ");

/** Calls the cluster's LiteLLM gateway to produce a qualitative post-match analysis
 *  from official match data. */
export async function analyzeMatch(digest: MatchDigest): Promise<MatchAnalysis> {
  const client = new OpenAI({
    baseURL: LITELLM_BASE_URL,
    apiKey: LITELLM_API_KEY,
  });
  const completion = await client.chat.completions.parse({
    model: LITELLM_MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: digestPrompt(digest) },
    ],
    response_format: zodResponseFormat(MatchAnalysisSchema, "match_analysis"),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("LiteLLM did not return a parseable match analysis");
  return sanitizeAnalysis(digest, parsed);
}

function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

function cleanPlayerName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

function playerTeams(d: MatchDigest): Map<string, { player: string; team: string }> {
  const out = new Map<string, { player: string; team: string }>();
  const add = (player: string | null | undefined, team: string | null | undefined) => {
    if (!player || !team) return;
    out.set(normalizeName(player), { player, team });
  };
  d.goals.forEach((g) => add(g.strPlayer, g.strTeam));
  d.cards.forEach((c) => add(c.strPlayer, c.strTeam));
  d.substitutions.forEach((s) => {
    add(s.playerIn, s.team);
    add(s.playerOut, s.team);
  });
  d.incidents.forEach((i) => add(i.player, i.team));
  d.shots.forEach((s) => add(s.player, s.team));
  d.homeLineup.forEach((p) => add(p, d.event.strHomeTeam));
  d.awayLineup.forEach((p) => add(p, d.event.strAwayTeam));
  return out;
}

function sanitizePlayerNote(
  note: { jogador: string; time: string; motivo: string },
  known: Map<string, { player: string; team: string }>,
): PlayerNoteValue | null {
  const clean = cleanPlayerName(note.jogador);
  const hit = known.get(normalizeName(clean));
  if (!hit) return null;
  return { jogador: hit.player, time: hit.team, motivo: note.motivo };
}

function fallbackNote(d: MatchDigest): PlayerNoteValue {
  const goal = d.goals[d.goals.length - 1] ?? d.goals[0];
  if (goal?.strPlayer && goal.strTeam) {
    return { jogador: goal.strPlayer, time: goal.strTeam, motivo: "Participou diretamente do placar oficial." };
  }
  const card = d.cards.find((c) => c.strPlayer && c.strTeam);
  if (card?.strPlayer && card.strTeam) {
    return { jogador: card.strPlayer, time: card.strTeam, motivo: "Foi citado nos acontecimentos oficiais da partida." };
  }
  return { jogador: d.event.strHomeTeam, time: d.event.strHomeTeam, motivo: "Não houve jogador individual suficiente nos dados oficiais." };
}

function concreteKeyEvents(d: MatchDigest): string[] {
  const goals = d.goals.map((g) => `${g.intTime}' ${g.strPlayer ?? "?"} (${g.strTeam ?? "?"}) marcou${g.strTimelineDetail ? ` — ${g.strTimelineDetail}` : ""}.`);
  const incidents = d.incidents.map((i) => `${i.minute}' ${i.team ?? "?"}: ${i.detail}`);
  const chances = d.clearChances.map((s) => `${s.minute}' ${s.team ?? "?"}: ${s.detail} xG~${s.xg}.`);
  const reds = d.cards.filter((c) => c.cardType === "red").map((c) => `${c.intTime}' ${c.strPlayer ?? "?"} (${c.strTeam ?? "?"}) foi expulso.`);
  const varRows = d.varIncidents.map((v) => `${v.minute}' VAR (${v.team ?? "?"}) — ${v.comment ?? "Revisão do VAR"}.`);
  const lateCards = d.cards.filter((c) => c.cardType !== "red").slice(-2).map((c) => `${c.intTime}' ${c.strPlayer ?? "?"} (${c.strTeam ?? "?"}) recebeu amarelo.`);
  return [...goals, ...chances, ...incidents, ...varRows, ...reds, ...lateCards].slice(0, 8);
}

function sanitizeTeam(value: string, d: MatchDigest): string {
  const team = [d.event.strHomeTeam, d.event.strAwayTeam, "Nenhum"].find((t) => t.toLowerCase() === value.toLowerCase());
  return team ?? "Nenhum";
}

function teamFromText(text: string, d: MatchDigest): string | null {
  const haystack = text.toLowerCase();
  if (haystack.includes(d.event.strHomeTeam.toLowerCase())) return d.event.strHomeTeam;
  if (haystack.includes(d.event.strAwayTeam.toLowerCase())) return d.event.strAwayTeam;
  return null;
}

function teamFromMissedPenalty(d: MatchDigest): string | null {
  return d.incidents.find((i) => /defendid|perdid|desperdi/i.test(i.detail))?.team ?? null;
}

function isPositiveHighlight(note: PlayerNoteValue): boolean {
  return !/expuls|prejudic|amarelo|vermelho|erro|falhou|sem incidentes|sem intervenções|titular,? sem/i.test(note.motivo);
}

function isNegativeError(note: PlayerNoteValue): boolean {
  return /perd|desperdi|cartão|amarelo|vermelho|expuls|erro|falh|prejudic|sem converter/i.test(note.motivo)
    && !/apesar|converteu|decisiv|garant/i.test(note.motivo);
}

function sanitizeAnalysis(d: MatchDigest, a: MatchAnalysis): MatchAnalysis {
  const known = playerTeams(d);
  const highlights = a.destaques.map((n) => sanitizePlayerNote(n, known)).filter((n): n is PlayerNoteValue => !!n).filter(isPositiveHighlight);
  const errors = a.maisErros.map((n) => sanitizePlayerNote(n, known)).filter((n): n is PlayerNoteValue => !!n).filter(isNegativeError);
  const fallback = fallbackNote(d);
  const azarTime = sanitizeTeam(a.azar.time, d);
  return {
    ...a,
    acontecimentosChave: concreteKeyEvents(d),
    leituraEstatistica: a.leituraEstatistica.slice(0, 8),
    azar: { ...a.azar, time: azarTime === "Nenhum" ? teamFromText(a.azar.motivo, d) ?? teamFromMissedPenalty(d) ?? azarTime : azarTime },
    melhorEmCampo: sanitizePlayerNote(a.melhorEmCampo, known) ?? fallback,
    destaques: (highlights.length ? highlights : [fallback]).slice(0, 5),
    maisErros: (errors.length ? errors : d.cards.slice(0, 2).map((c) => ({
      jogador: c.strPlayer ?? fallback.jogador,
      time: c.strTeam ?? fallback.time,
      motivo: `${c.cardType === "red" ? "Cartão vermelho" : "Cartão amarelo"} registrado oficialmente aos ${c.intTime}'.`,
    }))).slice(0, 4),
  };
}

function fmtPlayerNote(n: { jogador: string; time: string; motivo: string }): string {
  return `${flag(n.time)} *${n.jogador}* (${n.time}) — ${n.motivo}`;
}

function fmtOfficialStats(d: MatchDigest): string[] {
  const stats = d.stats.length
    ? d.stats.map((s) => `• ${s.strStat}: ${s.intHome ?? "-"} x ${s.intAway ?? "-"}`)
    : ["• nenhuma estatística oficial registrada"];
  return [...stats, ...d.unavailableStats.map((s) => `• ${s}`)];
}

function fmtExpectedGoals(d: MatchDigest, a: MatchAnalysis): string[] {
  return [
    `• Expectativa pré-jogo/modelo: ${d.xg.modelHome ?? "-"} x ${d.xg.modelAway ?? "-"}`,
    `• Timeline de chutes estimada: ${d.xg.timelineHome} x ${d.xg.timelineAway}`,
    `• IA pós-jogo: ${a.golsEsperadosIA.casa} x ${a.golsEsperadosIA.fora}`,
    `• Gols reais: ${d.xg.realHome ?? "?"} x ${d.xg.realAway ?? "?"}`,
    `• IA: ${a.golsEsperadosIA.motivo}`,
  ];
}

function fmtClearChances(d: MatchDigest): string[] {
  return d.clearChances.length
    ? d.clearChances.map((s) => `• ${s.minute}' ${flag(s.team ?? "")} ${s.player ?? "?"} (${s.team ?? "?"}) — ${s.detail} xG~${s.xg}`)
    : ["• nenhuma chance clara sem gol inferida por posição/defesa/pênalti"];
}

function fmtOfficialEvents(d: MatchDigest): string[] {
  const lines = [
    ...d.goals.map((g) => `• ${g.intTime}' ${flag(g.strTeam ?? "")} ${g.strPlayer ?? "?"} (${g.strTeam ?? "?"})${g.strTimelineDetail ? ` — ${g.strTimelineDetail}` : ""}`),
    ...d.cards.map((c) => `• ${c.intTime}' ${flag(c.strTeam ?? "")} ${c.strPlayer ?? "?"} (${c.strTeam ?? "?"}) — ${c.cardType === "red" ? "vermelho" : "amarelo"}`),
    ...d.substitutions.map((s) => `• ${s.minute}' ${flag(s.team ?? "")} ${s.playerIn ?? "?"} entrou, ${s.playerOut ?? "?"} saiu (${s.team ?? "?"})`),
    ...d.varIncidents.map((v) => `• ${v.minute}' ${flag(v.team ?? "")} VAR (${v.team ?? "?"}) — ${v.comment ?? "Revisão do VAR"}`),
    ...d.incidents.map((i) => `• ${i.minute}' ${flag(i.team ?? "")} ${i.detail}`),
  ];
  return lines.length ? lines : ["• nenhum gol, cartão, substituição, VAR ou incidente sem gol registrado"];
}

function fmtIntensity(d: MatchDigest): string[] {
  return d.intensity.length
    ? d.intensity.map((b) => `• ${b.label}: ${b.home} x ${b.away}`)
    : ["• nenhuma intensidade derivada registrada"];
}

export function fmtAnalysis(d: MatchDigest, a: MatchAnalysis): string {
  const e = d.event;
  const lines = [
    `🧠 *ANÁLISE DA PARTIDA (IA)*`,
    `${flag(e.strHomeTeam)} *${e.strHomeTeam} ${e.intHomeScore ?? "?"} x ${e.intAwayScore ?? "?"} ${e.strAwayTeam}* ${flag(e.strAwayTeam)}`,
    ``,
    a.resumo,
    ``,
    `📊 *Todas as estatísticas oficiais*`,
    ...fmtOfficialStats(d),
    ``,
    `🥅 *Gols esperados*`,
    ...fmtExpectedGoals(d, a),
    ``,
    `😱 *Gols perdidos / chances claras*`,
    ...fmtClearChances(d),
    ``,
    `🧾 *Acontecimentos oficiais*`,
    ...fmtOfficialEvents(d),
    ``,
    `🔥 *Intensidade por período*`,
    ...fmtIntensity(d),
    ``,
    `🔎 *Leitura da IA*`,
    ...a.leituraEstatistica.map((x) => `• ${x}`),
    ``,
    `🎬 *Acontecimentos-chave*`,
    ...a.acontecimentosChave.map((x) => `• ${x}`),
    ``,
    `⚖️ *Placar justo?*`,
    `${a.placarJusto.veredito} — ${a.placarJusto.motivo}`,
    ``,
    `🍀 *Azar / ineficiência*`,
    `${a.azar.time} — ${a.azar.motivo}`,
    ``,
    `⭐ *Melhor em campo*`,
    fmtPlayerNote(a.melhorEmCampo),
    ``,
    `🔝 *Quem jogou bem*`,
    ...a.destaques.map((n) => `• ${fmtPlayerNote(n)}`),
    ``,
    `🏆 *Quem merecia ganhar*`,
    `${a.mereciaGanhar.time} — ${a.mereciaGanhar.motivo}`,
    ``,
    `❌ *Quem mais errou*`,
    ...a.maisErros.map((n) => `• ${fmtPlayerNote(n)}`),
  ];
  return lines.join("\n");
}

/** Full flow: build the digest, ask the cluster LiteLLM gateway for a qualitative
 *  analysis, and post the write-up plus the match-intensity chart to Telegram. */
export async function postMatchAnalysis(e: WcEvent): Promise<MatchAnalysis> {
  const digest = await buildMatchDigest(e);
  const analysis = await analyzeMatch(digest);
  await sendMessage(fmtAnalysis(digest, analysis));
  const buckets = await matchIntensity(e.idEvent);
  const chart = matchIntensityChartUrl(buckets, e.strHomeTeam, e.strAwayTeam);
  if (chart) await sendPhoto(chart, `🔥 Mapa de calor — intensidade por período: ${e.strHomeTeam} x ${e.strAwayTeam}`);
  return analysis;
}
