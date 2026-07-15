import { expect, test } from "bun:test";
import { knownTeams, playerQuality, fifaRank } from "../src/elo.ts";
import { WORLD_CUP_GROUPS, fmtTournamentProjection, isKnockoutFixture, knockoutRoundName, selectTournamentChampion } from "../src/tournament.ts";
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
  expect(isKnockoutEvent({ ...event, strStage: "Round of 32", strEvent: "Brazil vs Japan" })).toBe(true);
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

test("fifaRank: uses the official 11 June snapshot for Brazil", () => {
  expect(fifaRank("Brazil")).toBe(6);
  expect(fifaRank("Portugal")).toBe(5);
});

test("knockoutRoundName: separates the bronze final from the title final", () => {
  const base = { strEvent: "TBD vs TBD", strStage: "Final", strStatus: "NS" } as WcEvent;
  expect(knockoutRoundName({ ...base, intRound: "101", strPlaceHolderA: "W97", strPlaceHolderB: "W98" })).toBe("Semifinal");
  expect(knockoutRoundName({ ...base, intRound: "102", strPlaceHolderA: "W99", strPlaceHolderB: "W100" })).toBe("Semifinal");
  expect(knockoutRoundName({ ...base, intRound: "103", strPlaceHolderA: "RU101", strPlaceHolderB: "RU102" })).toBeNull();
  expect(knockoutRoundName({ ...base, intRound: "104", strPlaceHolderA: "W101", strPlaceHolderB: "W102" })).toBe("Final");
});

test("selectTournamentChampion: uses the only title final, never the bronze match", () => {
  const prediction = {
    homeGoals: 1, awayGoals: 0, pHome: 0.5, pDraw: 0.3, pAway: 0.2,
    eloHome: 0, eloAway: 0, playerQualityHome: 0, playerQualityAway: 0,
    strengthHome: 0, strengthAway: 0,
  };
  const bronze = { round: "Terceiro lugar", home: "France", away: "England", winner: "France", prediction };
  const final = { round: "Final", home: "Spain", away: "Argentina", winner: "Spain", prediction };
  expect(selectTournamentChampion([[bronze], [final]], "fallback")).toBe("Spain");
  expect(selectTournamentChampion([[bronze]], "fallback")).toBe("fallback");
});

test("fmtTournamentProjection: reports Brazil's completed campaign after a real elimination", () => {
  const prediction = {
    homeGoals: 1, awayGoals: 2, pHome: 0.49, pDraw: 0.25, pAway: 0.26,
    eloHome: 2000, eloAway: 1900, playerQualityHome: 50, playerQualityAway: 26,
    strengthHome: 2050, strengthAway: 1926, fifaRankHome: 6, fifaRankAway: 23,
  };
  const loss = { round: "Oitavas", home: "Brazil", away: "Norway", winner: "Norway", prediction, real: true };
  const out = fmtTournamentProjection({
    generatedAt: "", groups: new Map(), qualifiers: [], knockout: [[loss]],
    champion: "indefinido", brazilPath: [loss],
  });
  expect(out).toContain("CAMPANHA DO BRASIL — encerrada nas Oitavas");
  expect(out).not.toContain("CAMINHO DO BRASIL — projeção completa");
});

test("fmtTournamentProjection: completed groups show final qualification state", () => {
  const teams = [
    { team: "A1", group: "A", played: 3, points: 9, gf: 6, ga: 1 },
    { team: "A2", group: "A", played: 3, points: 6, gf: 4, ga: 2 },
    { team: "A3", group: "A", played: 3, points: 3, gf: 2, ga: 3 },
    { team: "A4", group: "A", played: 3, points: 0, gf: 0, ga: 6 },
  ];
  const out = fmtTournamentProjection({
    generatedAt: "", groups: new Map([["A", teams]]), qualifiers: teams.slice(0, 2),
    knockout: [], champion: "A1", brazilPath: [],
  });
  expect(out).toContain("Fase de grupos — classificação final");
  expect(out).toContain("❌3.");
  expect(out).not.toContain("classificados esperados");
});
