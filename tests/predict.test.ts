import { expect, test } from "bun:test";
import { trainRatings, expectancy, outcomeOf } from "../src/elo.ts";
import { calibrateGoals, expectedGoalsFromMatrix, predictMatch, scoreMatrix } from "../src/predict.ts";
import { bracketAwareChampionForecast, championForecast } from "../src/champion.ts";
import type { WcEvent } from "../src/types.ts";

const ev = (h: string, a: string, hs: string, as: string): WcEvent => ({
  idEvent: `${h}${a}`, strEvent: `${h} vs ${a}`, dateEvent: "2026-06-13",
  strTimestamp: "2026-06-13 22:00:00", strStatus: "FT", strProgress: null,
  strHomeTeam: h, strAwayTeam: a, idHomeTeam: "1", idAwayTeam: "2",
  intHomeScore: hs, intAwayScore: as, strVenue: null, strLeague: "FIFA World Cup",
});

test("expectancy: stronger side favored, symmetric", () => {
  expect(expectancy(2000, 1500)).toBeGreaterThan(0.9);
  expect(expectancy(1500, 1500)).toBeCloseTo(0.5, 5);
  expect(expectancy(1500, 2000) + expectancy(2000, 1500)).toBeCloseTo(1, 5);
});

test("predictMatch: probabilities sum ~1 and favor stronger team", () => {
  const table = trainRatings([]);
  const p = predictMatch(table, "Brazil", "Paraguay");
  expect(p.pHome + p.pDraw + p.pAway).toBeCloseTo(1, 2);
  expect(p.pHome).toBeGreaterThan(p.pAway);
  expect(p.homeGoals).toBeGreaterThanOrEqual(p.awayGoals);
  expect(p.strengthHome).toBe(p.eloHome + p.playerQualityHome);
});

test("predictMatch: player quality improves equal-Elo strength", () => {
  const table = { France: 1800, Paraguay: 1800 };
  const p = predictMatch(table, "France", "Paraguay");
  expect(p.playerQualityHome).toBeGreaterThan(p.playerQualityAway);
  expect(p.strengthHome).toBeGreaterThan(p.strengthAway);
  expect(p.pHome).toBeGreaterThan(p.pAway);
});

test("predictMatch: head-to-head history nudges matchup", () => {
  const table = trainRatings([]);
  const neutral = predictMatch(table, "Brazil", "Argentina");
  const withH2h = predictMatch(table, "Brazil", "Argentina", [
    ev("Brazil", "Argentina", "0", "2"),
    ev("Argentina", "Brazil", "3", "1"),
  ]);
  expect(withH2h.pHome).toBeLessThan(neutral.pHome);
  expect(withH2h.pAway).toBeGreaterThan(neutral.pAway);
});

test("training moves ratings on upsets", () => {
  const base = trainRatings([]);
  const trained = trainRatings([ev("Paraguay", "Brazil", "3", "0")]);
  expect(trained["Paraguay"]!).toBeGreaterThan(base["Paraguay"]!);
  expect(trained["Brazil"]!).toBeLessThan(base["Brazil"]!);
});

test("championForecast: normalized, ranked desc", () => {
  const table = trainRatings([]);
  const odds = championForecast(table, ["Brazil", "Argentina", "Paraguay", "Qatar"]);
  expect(odds.reduce((s, o) => s + o.prob, 0)).toBeCloseTo(1, 5);
  expect(odds[0]!.prob).toBeGreaterThanOrEqual(odds[1]!.prob);
  expect(odds[0]!.strength).toBe(odds[0]!.elo + odds[0]!.playerQuality);
});

test("bracketAwareChampionForecast: eliminated teams have zero title probability", () => {
  const raw = championForecast(trainRatings([]), ["Brazil", "Spain", "Argentina"]);
  const adjusted = bracketAwareChampionForecast(raw, [
    { team: "Spain", prob: 0.6 }, { team: "Argentina", prob: 0.4 },
  ]);
  expect(adjusted.map((team) => team.team)).toEqual(["Spain", "Argentina"]);
  expect(adjusted.reduce((sum, team) => sum + team.prob, 0)).toBeCloseTo(1, 8);
  expect(adjusted.find((team) => team.team === "Brazil")).toBeUndefined();
});

test("scoreMatrix: normalized and consistent with predictMatch", () => {
  const table = trainRatings([]);
  const m = scoreMatrix(table, "Brazil", "Paraguay");
  const sum = m.flat().reduce((a, b) => a + b, 0);
  expect(sum).toBeCloseTo(1, 6);
  const p = predictMatch(table, "Brazil", "Paraguay");
  let pHome = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) if (i > j) pHome += m[i]![j]!;
  expect(pHome).toBeCloseTo(p.pHome, 2);
  const xg = expectedGoalsFromMatrix(m);
  expect(xg.home).toBeGreaterThan(0);
  expect(xg.away).toBeGreaterThan(0);
});

test("calibrateGoals: blends prior with observed totals", () => {
  expect(calibrateGoals([])).toBeCloseTo(2.6, 5);
  // 20 matches of 6 goals each pulls the average up, but the prior anchors it
  const highScoring = Array.from({ length: 20 }, (_, i) => ev(`T${i}`, `U${i}`, "4", "2"));
  const calibrated = calibrateGoals(highScoring);
  expect(calibrated).toBeGreaterThan(2.6);
  expect(calibrated).toBeLessThan(6);
  const wide = predictMatch(trainRatings([]), "Brazil", "Paraguay");
  expect(wide.homeGoals + wide.awayGoals).toBeGreaterThanOrEqual(2);
  calibrateGoals([]); // reset for other tests
});

test("outcomeOf parses result", () => {
  expect(outcomeOf(ev("USA", "Paraguay", "4", "1"))!.result).toBe("H");
  expect(outcomeOf(ev("Brazil", "Morocco", "1", "1"))!.result).toBe("D");
});
