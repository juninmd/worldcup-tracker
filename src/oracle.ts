import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Prediction, WcEvent } from "./types.ts";
import type { TournamentProjection } from "./tournament.ts";
import type { SimResult } from "./simulate.ts";
import { flag } from "./format.ts";
import { sendMessage } from "./telegram.ts";

// Same cluster LiteLLM gateway used by analysis.ts (OpenAI-compatible, no API bill).
const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL ?? "https://litellm.antonio-code.duckdns.org/v1";
const LITELLM_MODEL = process.env.LITELLM_MODEL ?? "cloud/gpt-oss-120b";

const client = () => new OpenAI({ baseURL: LITELLM_BASE_URL, apiKey: process.env.LITELLM_API_KEY ?? "" });

// ── Bracket oracle: qualitative read of the projected bracket + Monte Carlo ──

const BracketOracleSchema = z.object({
  veredito: z.string().describe("Leitura da chave projetada: obrigatoriamente de 2 a 4 frases completas em português do Brasil, citando lados da chave e confrontos concretos dos dados."),
  zebraProvavel: z.object({
    time: z.string(),
    motivo: z.string(),
  }).describe("Time fora dos favoritos com melhor chance de surpreender nesta chave."),
  jogoDaCopa: z.object({
    partida: z.string().describe("Ex.: 'Brazil x England (Quartas)'"),
    motivo: z.string(),
  }).describe("O confronto projetado mais imperdível do mata-mata."),
  alertaModelo: z.string().describe("Onde o modelo estatístico mais provavelmente está errando, em 1-2 frases."),
});

export type BracketOracle = z.infer<typeof BracketOracleSchema>;

const ORACLE_SYSTEM = [
  "Você é um analista de futebol experiente e cético, escrevendo em português do Brasil.",
  "Recebe a chave de mata-mata projetada por um modelo estatístico (Elo + Poisson) e as probabilidades de uma simulação de Monte Carlo.",
  "Avalie criticamente: o modelo só vê números — você conhece contexto tático, pressão, tradição em Copas.",
  "Seja específico e direto; nada de clichês. Não invente resultados que não estão nos dados.",
  "Os dados não contêm nomes de jogadores — NUNCA cite jogadores por nome, fale de seleções, setores e confrontos.",
  "O campo 'jogoDaCopa' deve ser um confronto do MATA-MATA listado, nunca da fase de grupos.",
].join(" ");

function bracketPrompt(p: TournamentProjection, sim: SimResult): string {
  const lines = [
    `Campeão projetado (modo): ${p.champion}`,
    ``,
    `Chave projetada (✔ = resultado real):`,
  ];
  for (const round of p.knockout) {
    lines.push(`${round[0]?.round}:`);
    for (const m of round) {
      lines.push(`- ${m.home} ${m.prediction.homeGoals}x${m.prediction.awayGoals} ${m.away} → ${m.winner}${m.real ? " ✔" : ""}`);
    }
  }
  lines.push(``, `Monte Carlo (${sim.runs} simulações) — título:`);
  for (const t of sim.title.slice(0, 10)) lines.push(`- ${t.team}: ${(t.prob * 100).toFixed(1)}%`);
  if (sim.finals.length) {
    lines.push(``, `Finais mais prováveis:`);
    for (const f of sim.finals.slice(0, 3)) lines.push(`- ${f.label}: ${(f.prob * 100).toFixed(1)}%`);
  }
  return lines.join("\n");
}

export async function bracketOracle(p: TournamentProjection, sim: SimResult): Promise<BracketOracle> {
  const completion = await client().chat.completions.parse({
    model: LITELLM_MODEL,
    max_tokens: 4096, // gpt-oss spends reasoning tokens from this budget
    messages: [
      { role: "system", content: ORACLE_SYSTEM },
      { role: "user", content: bracketPrompt(p, sim) },
    ],
    response_format: zodResponseFormat(BracketOracleSchema, "bracket_oracle"),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("LiteLLM did not return a parseable bracket oracle");
  return parsed;
}

export function fmtBracketOracle(o: BracketOracle): string {
  return [
    `🔮 *ORÁCULO DA COPA (IA)*`,
    ``,
    o.veredito,
    ``,
    `🦓 *Zebra de olho:* ${flag(o.zebraProvavel.time)} *${o.zebraProvavel.time}* — ${o.zebraProvavel.motivo}`,
    ``,
    `🍿 *Jogo da Copa:* ${o.jogoDaCopa.partida} — ${o.jogoDaCopa.motivo}`,
    ``,
    `⚠️ *Onde o modelo pode errar:* ${o.alertaModelo}`,
  ].join("\n");
}

export async function postBracketOracle(p: TournamentProjection, sim: SimResult): Promise<void> {
  await sendMessage(fmtBracketOracle(await bracketOracle(p, sim)));
}

// ── Brazil post-mortem: why the Seleção went out, grounded in real metrics ──

export interface BrazilPostMortemInput {
  eliminatedRound: string;
  eliminationScore: string; // "Brasil 1×2 Croácia"
  opponent: string;
  metricsSummary: string[]; // pre-formatted data lines (xG, conversão, disciplina…)
  redCards: string[];       // real red-card incidents: "Player (min') vs Opponent"
}

const BrazilPostMortemSchema = z.object({
  diagnostico: z.string().describe("2 a 4 frases: por que o Brasil caiu, ancorado nos números fornecidos, em português do Brasil."),
  ondeErrou: z.array(z.string()).min(2).max(4).describe("Pontos concretos de erro (setor, fase do jogo, conversão de chances) — sem inventar nomes de jogadores."),
  deveriaMelhorar: z.array(z.string()).min(2).max(3).describe("Recomendações concretas do que deveria ter sido melhor."),
  quemAtrapalhou: z.string().describe("O fator que mais pesou negativamente. Só cite jogador por NOME se ele constar na lista de cartões vermelhos reais fornecida; caso contrário, fale do setor/função."),
});

export type BrazilPostMortem = z.infer<typeof BrazilPostMortemSchema>;

const POSTMORTEM_SYSTEM = [
  "Você é um analista tático do futebol brasileiro, escrevendo em português do Brasil, crítico e direto.",
  "Recebe métricas REAIS da campanha do Brasil na Copa 2026 (derivadas do feed oficial FIFA) e faz um post-mortem da eliminação.",
  "Baseie-se SOMENTE nos dados fornecidos. NÃO invente nomes de jogadores: só pode citar jogadores que aparecem na lista de cartões vermelhos reais.",
  "Fora dessa lista, fale de setores (defesa, meio, ataque), fases do jogo e números — nunca invente nomes.",
].join(" ");

function postMortemPrompt(input: BrazilPostMortemInput): string {
  return [
    `Eliminação: ${input.eliminationScore} nas ${input.eliminatedRound} (adversário: ${input.opponent}).`,
    ``,
    `Métricas da campanha:`,
    ...input.metricsSummary.map((l) => `- ${l}`),
    ``,
    input.redCards.length
      ? `Cartões vermelhos reais do Brasil no torneio:\n${input.redCards.map((r) => `- ${r}`).join("\n")}`
      : `Sem cartões vermelhos do Brasil no torneio.`,
  ].join("\n");
}

export async function brazilPostMortem(input: BrazilPostMortemInput): Promise<BrazilPostMortem> {
  const completion = await client().chat.completions.parse({
    model: LITELLM_MODEL,
    max_tokens: 4096,
    messages: [
      { role: "system", content: POSTMORTEM_SYSTEM },
      { role: "user", content: postMortemPrompt(input) },
    ],
    response_format: zodResponseFormat(BrazilPostMortemSchema, "brazil_post_mortem"),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("LiteLLM did not return a parseable Brazil post-mortem");
  return parsed;
}

export function fmtBrazilPostMortem(input: BrazilPostMortemInput, o: BrazilPostMortem): string {
  return [
    `🇧🇷 *POST-MORTEM DA SELEÇÃO — Copa 2026 (IA + dados)*`,
    `❌ Eliminado nas *${input.eliminatedRound}*: ${input.eliminationScore}`,
    ``,
    o.diagnostico,
    ``,
    `🔧 *Onde errou:*`,
    ...o.ondeErrou.map((e) => `• ${e}`),
    ``,
    `📈 *O que deveria ter melhorado:*`,
    ...o.deveriaMelhorar.map((e) => `• ${e}`),
    ``,
    `⚠️ *Quem/o que mais atrapalhou:* ${o.quemAtrapalhou}`,
    `_Métricas derivadas do feed oficial FIFA; nomes só quando ancorados em incidentes reais._`,
  ].join("\n");
}

// ── Pre-match oracle: qualitative evaluation of a fixture before kickoff ──

const MatchPreviewSchema = z.object({
  leitura: z.string().describe("Avaliação tática do confronto em 2 a 3 frases, português do Brasil."),
  palpite: z.object({
    placar: z.string().describe("Ex.: '2x1'"),
    vencedor: z.string().describe("Nome do time, ou 'Empate'."),
    justificativa: z.string(),
  }),
  jogadorParaObservar: z.object({
    time: z.string(),
    motivo: z.string().describe("Por que o setor/estilo desse time decide o jogo (sem inventar nomes de jogadores)."),
  }),
});

export type MatchPreview = z.infer<typeof MatchPreviewSchema>;

const PREVIEW_SYSTEM = [
  "Você é um comentarista de futebol pré-jogo, escrevendo em português do Brasil.",
  "Recebe a previsão de um modelo estatístico e dados de desfalques. Dê sua leitura qualitativa do confronto.",
  "Pode discordar do modelo, explicando por quê. Não invente nomes de jogadores nem lesões que não estejam nos dados.",
].join(" ");

function previewPrompt(
  e: WcEvent,
  pred: Prediction,
  absences?: { home: { name: string }[]; away: { name: string }[] },
): string {
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const lines = [
    `Partida: ${e.strHomeTeam} x ${e.strAwayTeam}`,
    [e.strStage, e.strGroup].filter(Boolean).join(" · "),
    e.strVenue ? `Local: ${e.strVenue}` : "",
    ``,
    `Modelo estatístico:`,
    `- Placar mais provável: ${pred.homeGoals}x${pred.awayGoals}`,
    `- Probabilidades: ${e.strHomeTeam} ${pct(pred.pHome)} · empate ${pct(pred.pDraw)} · ${e.strAwayTeam} ${pct(pred.pAway)}`,
    `- Força (Elo+elenco): ${e.strHomeTeam} ${pred.strengthHome} · ${e.strAwayTeam} ${pred.strengthAway}`,
    pred.fifaRankHome ? `- Ranking FIFA: ${e.strHomeTeam} #${pred.fifaRankHome} · ${e.strAwayTeam} #${pred.fifaRankAway}` : "",
  ];
  const abs = (team: string, list?: { name: string }[]) =>
    list?.length ? `- Desfalques prováveis ${team}: ${list.map((a) => a.name).join(", ")}` : "";
  const a1 = abs(e.strHomeTeam, absences?.home), a2 = abs(e.strAwayTeam, absences?.away);
  if (a1 || a2) lines.push(``, a1, a2);
  return lines.filter(Boolean).join("\n");
}

export async function previewMatch(
  e: WcEvent,
  pred: Prediction,
  absences?: { home: { name: string }[]; away: { name: string }[] },
): Promise<MatchPreview> {
  const completion = await client().chat.completions.parse({
    model: LITELLM_MODEL,
    max_tokens: 3072, // gpt-oss spends reasoning tokens from this budget
    messages: [
      { role: "system", content: PREVIEW_SYSTEM },
      { role: "user", content: previewPrompt(e, pred, absences) },
    ],
    response_format: zodResponseFormat(MatchPreviewSchema, "match_preview"),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("LiteLLM did not return a parseable match preview");
  return parsed;
}

export function fmtMatchPreview(e: WcEvent, p: MatchPreview): string {
  return [
    `🎙 *AVALIAÇÃO PRÉ-JOGO (IA)* — ${flag(e.strHomeTeam)} ${e.strHomeTeam} x ${e.strAwayTeam} ${flag(e.strAwayTeam)}`,
    ``,
    p.leitura,
    ``,
    `🎯 *Palpite da IA:* ${p.palpite.placar} (${p.palpite.vencedor}) — ${p.palpite.justificativa}`,
    `👀 *Fique de olho:* ${flag(p.jogadorParaObservar.time)} ${p.jogadorParaObservar.time} — ${p.jogadorParaObservar.motivo}`,
  ].join("\n");
}
