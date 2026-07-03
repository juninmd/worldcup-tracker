import { expect, test } from "bun:test";
import { simulateKnockout, fmtSimulation } from "../src/simulate.ts";
import { trainRatings } from "../src/elo.ts";
import type { TournamentProjection, ProjectedMatch } from "../src/tournament.ts";

const match = (home: string, away: string, winner: string, real = false): ProjectedMatch => ({
  round: "Rodada de 32", home, away, winner, real,
  prediction: { homeGoals: 1, awayGoals: 0, pHome: 0.5, pDraw: 0.3, pAway: 0.2, eloHome: 0, eloAway: 0, playerQualityHome: 0, playerQualityAway: 0, strengthHome: 0, strengthAway: 0 },
});

const proj = (r32: ProjectedMatch[]): TournamentProjection => ({
  generatedAt: "", groups: new Map(), qualifiers: [], knockout: [r32], champion: "", brazilPath: [],
});

const table = trainRatings([]);

test("simulateKnockout: probs sum to 1, stronger team wins more, deterministic", () => {
  const r32 = [
    match("Brazil", "Haiti", "Brazil"),
    match("France", "Panama", "France"),
    match("Argentina", "Qatar", "Argentina"),
    match("Curacao", "Jordan", "Curacao"),
  ];
  const sim = simulateKnockout(proj(r32), table, [], 2000)!;
  expect(sim.title.reduce((s, t) => s + t.prob, 0)).toBeCloseTo(1, 5);
  const p = Object.fromEntries(sim.title.map((t) => [t.team, t.prob]));
  expect((p["Brazil"] ?? 0) + (p["France"] ?? 0) + (p["Argentina"] ?? 0)).toBeGreaterThan(0.8);
  expect(p["Brazil"] ?? 0).toBeGreaterThan(p["Curacao"] ?? 0);
  // same seed → identical result
  const again = simulateKnockout(proj(r32), table, [], 2000)!;
  expect(again.title).toEqual(sim.title);
});

test("simulateKnockout: real results are locked", () => {
  const r32 = [
    match("Haiti", "Brazil", "Haiti", true), // real upset: Haiti eliminated Brazil
    match("France", "Panama", "France"),
  ];
  const sim = simulateKnockout(proj(r32), table, [], 500)!;
  const p = Object.fromEntries(sim.title.map((t) => [t.team, t.prob]));
  expect(p["Brazil"]).toBeUndefined();
  expect(sim.brazilFunnel.every((f) => f.prob === 0)).toBe(true);
});

test("simulateKnockout: brazil funnel is monotonically non-increasing", () => {
  const r32 = [
    match("Brazil", "Haiti", "Brazil"),
    match("France", "Panama", "France"),
    match("Argentina", "Qatar", "Argentina"),
    match("Spain", "Jordan", "Spain"),
  ];
  const sim = simulateKnockout(proj(r32), table, [], 2000)!;
  for (let i = 1; i < sim.brazilFunnel.length; i++)
    expect(sim.brazilFunnel[i]!.prob).toBeLessThanOrEqual(sim.brazilFunnel[i - 1]!.prob);
  expect(fmtSimulation(sim)).toContain("Funil do Brasil");
});

test("simulateKnockout: null without a bracket", () => {
  expect(simulateKnockout(proj([]), table, [], 100)).toBeNull();
});
