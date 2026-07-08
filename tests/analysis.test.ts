import { expect, test } from "bun:test";
import { digestPrompt, fmtAnalysis, type MatchDigest, type MatchAnalysis } from "../src/analysis.ts";
import type { WcEvent } from "../src/types.ts";

const event = {
  strHomeTeam: "Brazil",
  strAwayTeam: "Argentina",
  intHomeScore: "2",
  intAwayScore: "1",
  strStage: "Final",
  strVenue: "MetLife Stadium",
  strCity: "New Jersey",
} as WcEvent;

const digest: MatchDigest = {
  event,
  stats: [{ strStat: "Shots on Goal", intHome: "6", intAway: "3" }],
  goals: [
    { intTime: "23", strPlayer: "Vinicius Junior", strTeam: "Brazil", strTimelineDetail: null } as never,
    { intTime: "80", strPlayer: "Messi", strTeam: "Argentina", strTimelineDetail: "Penalty" } as never,
  ],
  cards: [{ intTime: "67", strPlayer: "Casemiro", strTeam: "Brazil", strHome: "yes", cardType: "yellow" }],
  substitutions: [{ minute: "70", team: "Argentina", playerIn: "Di Maria", playerOut: "De Paul" }],
  varIncidents: [{ minute: "79", team: "Argentina", comment: "Penalty confirmed" }],
  incidents: [{ minute: "21", team: "Argentina", kind: "penalty", player: "Messi", detail: "Pênalti cobrado por Messi e defendido pelo goleiro adversário." }],
  shots: [
    { minute: "21", team: "Argentina", player: "Messi", x: 89, y: 50, outcome: "saved", zone: "penalty", xg: 0.76, clearChance: true, detail: "Messi (Argentina) finalizou de pênalti; resultado: defesa do goleiro." },
  ],
  clearChances: [
    { minute: "21", team: "Argentina", player: "Messi", x: 89, y: 50, outcome: "saved", zone: "penalty", xg: 0.76, clearChance: true, detail: "Messi (Argentina) finalizou de pênalti; resultado: defesa do goleiro." },
  ],
  xg: { modelHome: 1.5, modelAway: 1.1, timelineHome: 1.8, timelineAway: 0.9, realHome: 2, realAway: 1 },
  unavailableStats: ["Posse de bola: indisponível/nullable no feed FIFA live para este jogo", "Passes certos/errados: não expostos no feed FIFA usado pelo app"],
  intensity: [{ label: "76+", home: 1, away: 4 }],
  homeLineup: ["Alisson", "Vinicius Junior"],
  awayLineup: ["Messi"],
};

test("digestPrompt: includes score, stats, goals, cards and lineups in the prompt", () => {
  const prompt = digestPrompt(digest);
  expect(prompt).toContain("Brazil 2 x 1 Argentina");
  expect(prompt).toContain("Shots on Goal: 6 / 3");
  expect(prompt).toContain("Passes certos/errados: não expostos");
  expect(prompt).toContain("Expectativa pré-jogo do modelo: 1.5 / 1.1");
  expect(prompt).toContain("xG estimado pela timeline de chutes: 1.8 / 0.9");
  expect(prompt).toContain("21' Messi (Argentina): Messi (Argentina) finalizou de pênalti");
  expect(prompt).toContain("23' Vinicius Junior (Brazil)");
  expect(prompt).toContain("80' Messi (Argentina) [Penalty]");
  expect(prompt).toContain("67' Casemiro (Brazil) — amarelo");
  expect(prompt).toContain("70' Di Maria entrou, De Paul saiu (Argentina)");
  expect(prompt).toContain("79' Argentina: Penalty confirmed");
  expect(prompt).toContain("21' Argentina: Pênalti cobrado por Messi e defendido pelo goleiro adversário.");
  expect(prompt).toContain("76+: 1 / 4");
  expect(prompt).toContain("Titulares Brazil: Alisson, Vinicius Junior");
});

test("digestPrompt: reports no goals/cards when none happened", () => {
  const empty: MatchDigest = { ...digest, goals: [], cards: [], substitutions: [], varIncidents: [], incidents: [] };
  const prompt = digestPrompt(empty);
  expect(prompt).toContain("nenhum gol registrado");
  expect(prompt).toContain("nenhum cartão registrado");
  expect(prompt).toContain("nenhuma substituição registrada");
  expect(prompt).toContain("nenhuma revisão de VAR registrada");
  expect(prompt).toContain("nenhum incidente decisivo sem gol registrado");
});

test("fmtAnalysis: renders the LLM analysis and the match's card list", () => {
  const analysis: MatchAnalysis = {
    resumo: "Brasil venceu um jogo equilibrado com eficiência ofensiva superior.",
    acontecimentosChave: [
      "Vinicius Junior abriu o placar aos 23 minutos.",
      "Messi descontou de pênalti aos 80 minutos.",
      "Casemiro recebeu amarelo aos 67 minutos.",
    ],
    leituraEstatistica: [
      "O Brasil finalizou mais no alvo: 6 contra 3.",
      "A Argentina seguiu viva pela bola parada.",
      "A disciplina pesou pelo cartão de Casemiro.",
    ],
    placarJusto: { veredito: "justo", motivo: "O Brasil teve mais finalizações no alvo e venceu pela margem mínima." },
    azar: { time: "Argentina", motivo: "Teve menos volume no alvo e precisou de pênalti para marcar." },
    golsEsperadosIA: { casa: 1.9, fora: 1.0, motivo: "O volume de chutes favoreceu o Brasil." },
    melhorEmCampo: { jogador: "Vinicius Junior", time: "Brazil", motivo: "Decidiu o jogo com um gol." },
    destaques: [{ jogador: "Alisson", time: "Brazil", motivo: "Defesas decisivas." }],
    mereciaGanhar: { time: "Brazil", motivo: "Criou mais chances claras." },
    maisErros: [{ jogador: "Otamendi", time: "Argentina", motivo: "Erro no lance do primeiro gol." }],
  };

  const out = fmtAnalysis(digest, analysis);
  expect(out).toContain("ANÁLISE DA PARTIDA (IA)");
  expect(out).toContain("Brazil 2 x 1 Argentina");
  expect(out).toContain("Todas as estatísticas oficiais");
  expect(out).toContain("Shots on Goal: 6 x 3");
  expect(out).toContain("Gols esperados");
  expect(out).toContain("Expectativa pré-jogo/modelo: 1.5 x 1.1");
  expect(out).toContain("Timeline de chutes estimada: 1.8 x 0.9");
  expect(out).toContain("IA pós-jogo: 1.9 x 1");
  expect(out).toContain("Gols perdidos / chances claras");
  expect(out).toContain("Messi (Argentina) finalizou de pênalti");
  expect(out).toContain("Acontecimentos oficiais");
  expect(out).toContain("23' 🇧🇷 Vinicius Junior (Brazil)");
  expect(out).toContain("80' 🇦🇷 Messi (Argentina) — Penalty");
  expect(out).toContain("67' 🇧🇷 Casemiro (Brazil) — amarelo");
  expect(out).toContain("70' 🇦🇷 Di Maria entrou, De Paul saiu (Argentina)");
  expect(out).toContain("79' 🇦🇷 VAR (Argentina) — Penalty confirmed");
  expect(out).toContain("21' 🇦🇷 Pênalti cobrado por Messi e defendido pelo goleiro adversário.");
  expect(out).toContain("Intensidade por período");
  expect(out).toContain("76+: 1 x 4");
  expect(out).toContain("Placar justo?");
  expect(out).toContain("justo — O Brasil teve mais finalizações no alvo");
  expect(out).toContain("Azar / ineficiência");
  expect(out).toContain("Vinicius Junior");
  expect(out).toContain("Otamendi");
});
