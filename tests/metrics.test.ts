import { expect, test } from "bun:test";
import { buildLeakFreeBacktest, evaluatePredictions, fmtModelMetrics, type EvaluatedPrediction } from "../src/metrics.ts";
import type { WcEvent } from "../src/types.ts";

const rows: EvaluatedPrediction[] = [
  { eventId: "1", stage: "Round of 16", home: "Brazil", away: "Norway", pHome: 0.6, pDraw: 0.25, pAway: 0.15, predictedHome: 2, predictedAway: 1, actualHome: 1, actualAway: 2 },
  { eventId: "2", stage: "Semi-final", home: "Spain", away: "France", pHome: 0.5, pDraw: 0.3, pAway: 0.2, predictedHome: 1, predictedAway: 1, actualHome: 2, actualAway: 0 },
];

test("evaluatePredictions: computes proper scores, accuracy, calibration and Brazil bias", () => {
  const metrics = evaluatePredictions(rows);
  expect(metrics.matches).toBe(2);
  expect(metrics.resultAccuracy).toBe(0.5);
  expect(metrics.exactScoreRate).toBe(0);
  expect(metrics.goalMae).toBe(1);
  expect(metrics.brier).toBeCloseTo(0.7625, 4);
  expect(metrics.logLoss).toBeCloseTo((-Math.log(0.15) - Math.log(0.5)) / 2, 4);
  expect(metrics.calibrationError).toBeGreaterThan(0);
  expect(metrics.brazil.matches).toBe(1);
  expect(metrics.brazil.goalBias).toBe(1);
  expect(metrics.brazil.brier).toBeCloseTo(1.145, 4);
  expect(metrics.byStage["Round of 16"]?.matches).toBe(1);
  expect(metrics.byStage["Semi-final"]?.matches).toBe(1);
  expect(metrics.byConfidence["50-65%"]?.matches).toBe(2);
});

test("evaluatePredictions: empty input is explicit, never NaN", () => {
  const metrics = evaluatePredictions([]);
  expect(metrics.matches).toBe(0);
  expect(metrics.brier).toBeNull();
  expect(fmtModelMetrics(metrics)).toContain("sem previsões avaliáveis");
});

test("evaluatePredictions: FIFA favorite baseline counts draws as misses", () => {
  const ranked = rows.map((row, index) => ({
    ...row, fifaRankHome: 1, fifaRankAway: 2,
    actualHome: index === 0 ? 1 : 2, actualAway: index === 0 ? 1 : 0,
  }));
  expect(evaluatePredictions(ranked).fifaFavoriteAccuracy).toBe(0.5);
});

test("fmtModelMetrics: identifies estimated metrics and their meaning", () => {
  const out = fmtModelMetrics(evaluatePredictions(rows));
  expect(out).toContain("Brier");
  expect(out).toContain("Log Loss");
  expect(out).toContain("Calibração");
  expect(out).toContain("Brasil");
  expect(out).toContain("Por fase");
  expect(out).toContain("Faixa de confiança");
  expect(out).toContain("Odds de mercado: n/d");
  expect(out).toContain("menor é melhor");
});

const event = (id: string, timestamp: string, homeScore: number, awayScore: number): WcEvent => ({
  idEvent: id, strEvent: `Brazil vs Norway`, dateEvent: timestamp.slice(0, 10), strTimestamp: timestamp,
  strStatus: "FT", strProgress: null, strHomeTeam: "Brazil", strAwayTeam: "Norway",
  idHomeTeam: "BRA", idAwayTeam: "NOR", intHomeScore: String(homeScore), intAwayScore: String(awayScore),
  strVenue: null, strLeague: "FIFA World Cup",
});

test("buildLeakFreeBacktest: a future result cannot change an earlier prediction", () => {
  const first = event("1", "2026-06-01T12:00:00Z", 1, 0);
  const future = event("2", "2026-06-10T12:00:00Z", 0, 9);
  const before = buildLeakFreeBacktest([first])[0]!;
  const after = buildLeakFreeBacktest([future, first])[0]!;
  expect(after.eventId).toBe("1");
  expect(after).toEqual(before);
});

test("evaluatePredictions: proper-score metrics stay bounded across generated probabilities", () => {
  const generated: EvaluatedPrediction[] = Array.from({ length: 200 }, (_, index) => {
    const raw = [index % 17 + 1, index % 11 + 1, index % 7 + 1];
    const total = raw.reduce((sum, value) => sum + value, 0);
    const actual = index % 3;
    return {
      eventId: String(index), home: "A", away: "B",
      pHome: raw[0]! / total, pDraw: raw[1]! / total, pAway: raw[2]! / total,
      predictedHome: index % 4, predictedAway: (index + 1) % 4,
      actualHome: actual === 0 ? 1 : 0, actualAway: actual === 2 ? 1 : 0,
    };
  });
  const metrics = evaluatePredictions(generated);
  expect(metrics.brier).toBeWithin(0, 2);
  expect(metrics.rankedProbabilityScore).toBeWithin(0, 1);
  expect(metrics.calibrationError).toBeWithin(0, 1);
  expect(metrics.resultAccuracy).toBeWithin(0, 1);
  expect(metrics.exactScoreRate).toBeWithin(0, 1);
});
