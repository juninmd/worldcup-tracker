import { expect, test } from "bun:test";
import { fmtStats } from "../src/details.ts";
import type { WcEvent, EventStat } from "../src/types.ts";

const dummyEvent = {
  strHomeTeam: "Brazil",
  strAwayTeam: "Argentina",
} as WcEvent;

test("fmtStats: handles empty stats", () => {
  expect(fmtStats(dummyEvent, [])).toBe("");
});

test("fmtStats: parses standard numbers, percentages, and fractions", () => {
  const stats: EventStat[] = [
    { strStat: "Ball Possession", intHome: "55%", intAway: "45%" },
    { strStat: "Shots on Goal", intHome: "8", intAway: "4" },
    { strStat: "Passes accurate", intHome: "381 / 432", intAway: "310 / 380" },
    { strStat: "Red Cards", intHome: null, intAway: "1" },
  ];
  const out = fmtStats(dummyEvent, stats);
  expect(out).toContain("Brazil");
  expect(out).toContain("Argentina");
  // 55% vs 45% -> total 100 -> n = 6 -> ▰▰▰▰▰▰▱▱▱▱
  expect(out).toContain("▰▰▰▰▰▰▱▱▱▱");
  // 8 vs 4 -> total 12 -> n = 7 -> ▰▰▰▰▰▰▰▱▱▱
  expect(out).toContain("▰▰▰▰▰▰▰▱▱▱");
  // 381 vs 310 -> total 691 -> n = 6 -> ▰▰▰▰▰▰▱▱▱▱
  expect(out).toContain("▰▰▰▰▰▰▱▱▱▱");
  // null (0) vs 1 -> total 1 -> n = 0 -> ▱▱▱▱▱▱▱▱▱▱
  expect(out).toContain("▱▱▱▱▱▱▱▱▱▱");
});
