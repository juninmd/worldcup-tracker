import { expect, test } from "bun:test";
import { trainRatings, expectancy, outcomeOf } from "../src/elo.ts";
import { predictMatch } from "../src/predict.ts";
import { championForecast } from "../src/champion.ts";
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
});

test("outcomeOf parses result", () => {
  expect(outcomeOf(ev("USA", "Paraguay", "4", "1"))!.result).toBe("H");
  expect(outcomeOf(ev("Brazil", "Morocco", "1", "1"))!.result).toBe("D");
});
