import { expect, test } from "bun:test";
import {
  FRIENDLIES_COMPETITION_ID,
  QUALIFIERS_COMPETITION_ID,
  type CycleMatch,
  classifyCycleMatch,
  cycleEloMoves,
  finishedCycleEvents,
  fmtCycleStandings,
  isPlayed,
  qualifyingTable,
  yearlyWindows,
} from "../src/cycle.ts";
import type { WcEvent } from "../src/types.ts";

let seq = 0;
const match = (home: string, hs: number | null, as: number | null, away: string, comp = QUALIFIERS_COMPETITION_ID): WcEvent => ({
  idEvent: `e${++seq}`, strEvent: `${home} vs ${away}`, dateEvent: "2027-09-05",
  strTimestamp: `2027-09-05T20:00:0${seq % 10}Z`, strStatus: hs === null ? "NS" : "FT", strProgress: null,
  strHomeTeam: home, strAwayTeam: away, idHomeTeam: home, idAwayTeam: away,
  intHomeScore: hs === null ? null : String(hs), intAwayScore: as === null ? null : String(as),
  strVenue: null, strLeague: "FIFA World Cup", idCompetition: comp,
} as WcEvent);

const cycle = (events: WcEvent[]): CycleMatch[] => events.map((e) => ({ event: e, kind: classifyCycleMatch(e) }));

test("classifyCycleMatch: keys off competition id, not the fixed league label", () => {
  expect(classifyCycleMatch(match("Brazil", 1, 0, "Peru"))).toBe("qualifier");
  expect(classifyCycleMatch(match("Australia", 0, 2, "Brazil", FRIENDLIES_COMPETITION_ID))).toBe("friendly");
  expect(classifyCycleMatch(match("Brazil", 1, 1, "Spain", "999"))).toBe("other");
});

test("yearlyWindows: splits the cycle into ≤1-year slices, covering it end to end", () => {
  const windows = yearlyWindows("2026-07-20", "2030-06-08");
  expect(windows[0]).toEqual(["2026-07-20", "2027-07-20"]);
  expect(windows.at(-1)![1]).toBe("2030-06-08");
  const YEAR_MS = 366 * 86_400_000;
  for (const [from, to] of windows) {
    expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(YEAR_MS);
  }
  // no gap between one window's end and the next window's start
  for (let i = 1; i < windows.length; i++) {
    expect(Date.parse(windows[i]![0]) - Date.parse(windows[i - 1]![1])).toBe(86_400_000);
  }
});

test("yearlyWindows: a window already under a year stays a single slice", () => {
  expect(yearlyWindows("2026-07-20", "2026-12-31")).toEqual([["2026-07-20", "2026-12-31"]]);
});

test("isPlayed: a scoreless fixture is not a 0–0 (Number(null) is 0, not NaN)", () => {
  expect(isPlayed(match("Brazil", null, null, "Peru"))).toBe(false);
  expect(isPlayed(match("Brazil", 0, 0, "Peru"))).toBe(true);
});

test("finishedCycleEvents: nothing to fetch before the cycle opens", async () => {
  expect(await finishedCycleEvents(new Date("2026-06-01T00:00:00Z"))).toEqual([]);
});

test("qualifyingTable: 3/1/0 points and CONMEBOL tie-breaks", () => {
  const table = qualifyingTable(cycle([
    match("Brazil", 3, 0, "Bolivia"),
    match("Argentina", 1, 0, "Chile"),
    match("Chile", 2, 2, "Brazil"),
    match("Bolivia", 0, 1, "Argentina"),
  ]));
  expect(table.map((r) => `${r.team} ${r.points}`)).toEqual([
    "Argentina 6", "Brazil 4", "Chile 1", "Bolivia 0",
  ]);
  const brazil = table.find((r) => r.team === "Brazil")!;
  expect([brazil.played, brazil.win, brazil.draw, brazil.loss, brazil.diff]).toEqual([2, 1, 1, 0, 3]);
  expect(table.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
});

test("qualifyingTable: equal points broken by goal difference, then goals scored", () => {
  const table = qualifyingTable(cycle([
    match("Uruguay", 1, 0, "Peru"), // +1
    match("Colombia", 3, 0, "Ecuador"), // +3
    match("Paraguay", 2, 1, "Venezuela"), // +1, 2 GF
  ]));
  expect(table.slice(0, 3).map((r) => r.team)).toEqual(["Colombia", "Paraguay", "Uruguay"]);
});

test("qualifyingTable: competition 520 is global, so non-CONMEBOL sides are excluded", () => {
  const table = qualifyingTable(cycle([
    match("Brazil", 2, 0, "Chile"),
    match("Japan", 3, 0, "Mongolia"), // same competition id, different confederation
    match("Brazil", 1, 0, "Morocco"), // mixed pair — not a CONMEBOL group match
  ]));
  expect(table.map((r) => r.team)).toEqual(["Brazil", "Chile"]);
  expect(table.find((r) => r.team === "Brazil")!.played).toBe(1);
});

test("qualifyingTable: ignores friendlies and unplayed fixtures", () => {
  const table = qualifyingTable(cycle([
    match("Australia", 0, 3, "Brazil", FRIENDLIES_COMPETITION_ID),
    match("Brazil", null, null, "Peru"),
  ]));
  expect(table).toEqual([]);
});

test("cycleEloMoves: cycle results move ratings on from the 2026 table", () => {
  const worldCup = [match("Brazil", 1, 0, "Spain", "17")];
  const moves = cycleEloMoves(worldCup, cycle([match("Bolivia", 2, 0, "Brazil")]));
  const bolivia = moves.find((m) => m.team === "Bolivia")!;
  const brazil = moves.find((m) => m.team === "Brazil")!;
  expect(bolivia.delta).toBeGreaterThan(0); // beating a stronger side is worth a lot
  expect(brazil.delta).toBeLessThan(0);
  expect(bolivia.delta).toBe(-brazil.delta); // Elo is zero-sum
  expect(bolivia.after - bolivia.before).toBe(bolivia.delta);
});

test("cycleEloMoves: no finished cycle match leaves ratings untouched", () => {
  expect(cycleEloMoves([match("Brazil", 1, 0, "Spain", "17")], cycle([match("Brazil", null, null, "Peru")]))).toEqual([]);
});

test("fmtCycleStandings: says the qualifiers are unpublished instead of faking a table", () => {
  const msg = fmtCycleStandings({ matches: [], table: [], eloMoves: [], played: 0, upcoming: [] });
  expect(msg).toContain("ainda não foram publicadas");
  expect(msg).toContain("ratings seguem os da Copa de 2026");
  expect(msg).not.toContain("vaga direta");
});

test("fmtCycleStandings: marks direct slots and the play-off as a 2026-cycle projection", () => {
  const matches = cycle([
    match("Brazil", 3, 0, "Bolivia"), match("Argentina", 1, 0, "Chile"),
    match("Uruguay", 2, 0, "Peru"), match("Colombia", 1, 0, "Ecuador"),
    match("Paraguay", 1, 0, "Venezuela"),
  ]);
  const msg = fmtCycleStandings({
    matches, table: qualifyingTable(matches), eloMoves: [], played: 5,
    upcoming: [{ event: match("Brazil", null, null, "Peru"), kind: "qualifier" }],
  });
  expect(msg).toContain("✅"); // top six
  expect(msg).toContain("a FIFA ainda não definiu as vagas de 2030");
  expect(msg).toContain("05/09/2027 Brazil x Peru _(Eliminatórias)_");
});
