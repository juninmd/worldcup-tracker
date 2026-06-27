import { expect, test } from "bun:test";
import { knownTeams, playerQuality, fifaRank } from "../src/elo.ts";
import { WORLD_CUP_GROUPS, isKnockoutFixture } from "../src/tournament.ts";
import { isKnockoutEvent } from "../src/standings.ts";
import type { WcEvent } from "../src/types.ts";

test("WORLD_CUP_GROUPS: official fallback covers 12 groups and 48 unique teams", () => {
  const groups = Object.values(WORLD_CUP_GROUPS);
  const teams = groups.flat();
  expect(groups).toHaveLength(12);
  expect(groups.every((g) => g.length === 4)).toBe(true);
  expect(new Set(teams).size).toBe(48);
});

test("WORLD_CUP_GROUPS: every fallback team has seeded ratings, player quality, and FIFA rank", () => {
  const seeded = new Set(knownTeams());
  const teams = Object.values(WORLD_CUP_GROUPS).flat();

  const missingSeed = teams.filter((team) => !seeded.has(team));
  expect(missingSeed).toEqual([]);

  const missingQuality = teams.filter((team) => !playerQuality(team) || playerQuality(team) <= 0);
  expect(missingQuality).toEqual([]);

  const missingRank = teams.filter((team) => fifaRank(team) === null);
  expect(missingRank).toEqual([]);
});

test("isKnockoutEvent: group round numbers are not knockout", () => {
  const event = {
    strEvent: "Germany vs Ivory Coast",
    intRound: "2",
  } as WcEvent;
  expect(isKnockoutEvent(event)).toBe(false);
  expect(isKnockoutEvent({ ...event, strEvent: "Round of 16: Germany vs Spain" })).toBe(true);
});

test("isKnockoutFixture: detects knockout rounds (incl. pt-BR labels), ignores group stage", () => {
  const base = { strEvent: "", strStatus: "FT" } as WcEvent;
  expect(isKnockoutFixture({ ...base, strEvent: "Group C: Brazil vs Morocco" })).toBe(false);
  expect(isKnockoutFixture({ ...base, strEvent: "Round of 32: Brazil vs Norway" })).toBe(true);
  expect(isKnockoutFixture({ ...base, strEvent: "Oitavas de final: Brazil vs Japan" })).toBe(true);
  expect(isKnockoutFixture({ ...base, strEvent: "Quarter-final: France vs Brazil" })).toBe(true);
  expect(isKnockoutFixture({ ...base, strEvent: "Final: Brazil vs Argentina" })).toBe(true);
  expect(isKnockoutFixture({ ...base, strEvent: "Match", strStatus: "Round 1" })).toBe(false);
  expect(isKnockoutFixture({ ...base, strEvent: "Match", strStatus: "Semifinal" })).toBe(true);
});
