import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { WcEvent, EventStat, TimelineItem, CardEvent, IntensityBucket } from "./types.ts";
import { eventStats, timeline, cardEvents, matchIntensity, lineup } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { matchIntensityChartUrl } from "./charts.ts";

const MODEL = "claude-opus-4-8";

const PlayerNote = z.object({
  jogador: z.string(),
  time: z.string(),
  motivo: z.string(),
});

const MatchAnalysisSchema = z.object({
  resumo: z.string().describe("Resumo objetivo da partida em português do Brasil, 2 a 4 frases."),
  melhorEmCampo: PlayerNote.describe("O jogador em campo com melhor desempenho na partida."),
  destaques: z.array(PlayerNote).describe("De 2 a 5 jogadores que jogaram bem, de ambos os times quando fizer sentido."),
  mereciaGanhar: z.object({
    time: z.string().describe("Nome do time (ou 'Empate' se o resultado refletiu o jogo)."),
    motivo: z.string(),
  }).describe("Avaliação de qual time merecia vencer com base no desempenho, não apenas no placar."),
  maisErros: z.array(PlayerNote).describe("De 1 a 4 jogadores que mais erraram ou pesaram negativamente no jogo."),
});

export type MatchAnalysis = z.infer<typeof MatchAnalysisSchema>;

export interface MatchDigest {
  event: WcEvent;
  stats: EventStat[];
  goals: TimelineItem[];
  cards: CardEvent[];
  homeLineup: string[];
  awayLineup: string[];
}

export async function buildMatchDigest(e: WcEvent): Promise<MatchDigest> {
  const [stats, goals, cards, players] = await Promise.all([
    eventStats(e.idEvent),
    timeline(e.idEvent),
    cardEvents(e.idEvent),
    lineup(e.idEvent),
  ]);
  const starters = players.filter((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
  return {
    event: e,
    stats,
    goals,
    cards,
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
    ``,
    `Estatísticas oficiais (casa / fora):`,
    ...d.stats.map((s) => `- ${s.strStat}: ${s.intHome ?? "-"} / ${s.intAway ?? "-"}`),
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
  ];
  if (d.homeLineup.length) lines.push(``, `Titulares ${e.strHomeTeam}: ${d.homeLineup.join(", ")}`);
  if (d.awayLineup.length) lines.push(``, `Titulares ${e.strAwayTeam}: ${d.awayLineup.join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

const SYSTEM_PROMPT = [
  "Você é um analista técnico de futebol imparcial, escrevendo em português do Brasil.",
  "Baseie-se estritamente nos dados oficiais fornecidos (placar, estatísticas, gols, cartões e titulares).",
  "Não invente jogadores, eventos ou estatísticas que não estejam nos dados.",
  "Se os titulares não forem informados, cite apenas jogadores que aparecem nos gols/cartões.",
  "Seja direto e específico, evitando clichês genéricos.",
].join(" ");

/** Calls Claude to produce a qualitative post-match analysis from official match data. */
export async function analyzeMatch(digest: MatchDigest): Promise<MatchAnalysis> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: digestPrompt(digest) }],
    output_config: {
      format: zodOutputFormat(MatchAnalysisSchema),
      effort: "high",
    },
  });
  if (!response.parsed_output) throw new Error("Claude did not return a parseable match analysis");
  return response.parsed_output;
}

function fmtPlayerNote(n: { jogador: string; time: string; motivo: string }): string {
  return `${flag(n.time)} *${n.jogador}* (${n.time}) — ${n.motivo}`;
}

export function fmtAnalysis(d: MatchDigest, a: MatchAnalysis): string {
  const e = d.event;
  const lines = [
    `🧠 *ANÁLISE DA PARTIDA (IA)*`,
    `${flag(e.strHomeTeam)} *${e.strHomeTeam} ${e.intHomeScore ?? "?"} x ${e.intAwayScore ?? "?"} ${e.strAwayTeam}* ${flag(e.strAwayTeam)}`,
    ``,
    a.resumo,
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
  if (d.cards.length) {
    lines.push(``, `🟨 *Cartões da partida*`);
    for (const c of d.cards) {
      lines.push(`• ${c.intTime}' ${flag(c.strTeam ?? "")} ${c.strPlayer ?? "?"} (${c.strTeam ?? "?"}) ${c.cardType === "red" ? "🟥" : "🟨"}`);
    }
  }
  return lines.join("\n");
}

/** Full flow: build the digest, ask Claude for a qualitative analysis, and post
 *  the write-up plus the match-intensity ("heatmap") chart to Telegram. */
export async function postMatchAnalysis(e: WcEvent): Promise<MatchAnalysis> {
  const digest = await buildMatchDigest(e);
  const analysis = await analyzeMatch(digest);
  await sendMessage(fmtAnalysis(digest, analysis));
  const buckets = await matchIntensity(e.idEvent);
  const chart = matchIntensityChartUrl(buckets, e.strHomeTeam, e.strAwayTeam);
  if (chart) await sendPhoto(chart, `🔥 Mapa de calor — intensidade por período: ${e.strHomeTeam} x ${e.strAwayTeam}`);
  return analysis;
}
