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
  homeLineup: ["Alisson", "Vinicius Junior"],
  awayLineup: ["Messi"],
};

test("digestPrompt: includes score, stats, goals, cards and lineups in the prompt", () => {
  const prompt = digestPrompt(digest);
  expect(prompt).toContain("Brazil 2 x 1 Argentina");
  expect(prompt).toContain("Shots on Goal: 6 / 3");
  expect(prompt).toContain("23' Vinicius Junior (Brazil)");
  expect(prompt).toContain("80' Messi (Argentina) [Penalty]");
  expect(prompt).toContain("67' Casemiro (Brazil) — amarelo");
  expect(prompt).toContain("Titulares Brazil: Alisson, Vinicius Junior");
});

test("digestPrompt: reports no goals/cards when none happened", () => {
  const empty: MatchDigest = { ...digest, goals: [], cards: [] };
  const prompt = digestPrompt(empty);
  expect(prompt).toContain("nenhum gol registrado");
  expect(prompt).toContain("nenhum cartão registrado");
});

test("fmtAnalysis: renders the LLM analysis and the match's card list", () => {
  const analysis: MatchAnalysis = {
    resumo: "Brasil venceu um jogo equilibrado com eficiência ofensiva superior.",
    melhorEmCampo: { jogador: "Vinicius Junior", time: "Brazil", motivo: "Decidiu o jogo com um gol." },
    destaques: [{ jogador: "Alisson", time: "Brazil", motivo: "Defesas decisivas." }],
    mereciaGanhar: { time: "Brazil", motivo: "Criou mais chances claras." },
    maisErros: [{ jogador: "Otamendi", time: "Argentina", motivo: "Erro no lance do primeiro gol." }],
  };

  const out = fmtAnalysis(digest, analysis);
  expect(out).toContain("ANÁLISE DA PARTIDA (IA)");
  expect(out).toContain("Brazil 2 x 1 Argentina");
  expect(out).toContain("Vinicius Junior");
  expect(out).toContain("Otamendi");
  expect(out).toContain("Cartões da partida");
  expect(out).toContain("67' 🇧🇷 Casemiro (Brazil) 🟨");
});
