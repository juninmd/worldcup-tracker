import { expect, test } from "bun:test";
import { fmtStandings, qualificationStatuses } from "../src/standings.ts";
import type { TableRow } from "../src/types.ts";

const row = (group: string, team: string, points: number, gd: number, gf: number): TableRow => ({
  intRank: null, strTeam: team, strGroup: group, intPlayed: "3",
  intWin: null, intDraw: null, intLoss: null,
  intGoalsFor: String(gf), intGoalsAgainst: String(gf - gd),
  intGoalDifference: String(gd), intPoints: String(points),
});

function completeField(): TableRow[] {
  return "ABCDEFGHIJKL".split("").flatMap((group, index) => [
    row(group, `${group}1`, 9, 6, 8),
    row(group, `${group}2`, 6, 2, 5),
    row(group, `${group}3`, 12 - index, 1, 4),
    row(group, `${group}4`, 0, -6, 1),
  ]);
}

test("qualificationStatuses: qualifies exactly the best eight third-placed teams", () => {
  const statuses = qualificationStatuses(completeField());
  expect([...statuses.values()].filter((status) => status === "qualified")).toHaveLength(32);
  for (const group of "ABCDEFGH") expect(statuses.get(`${group}3`)).toBe("qualified");
  for (const group of "IJKL") expect(statuses.get(`${group}3`)).toBe("eliminated");
});

test("fmtStandings: explains the best-third qualification instead of claiming only top two advance", () => {
  const out = fmtStandings(completeField());
  expect(out).toContain("MELHORES TERCEIROS");
  expect(out).toContain("8 melhores terceiros");
  expect(out).not.toContain("zona de classificação (top 2 do grupo)");
});

test("qualificationStatuses: incomplete groups remain provisional", () => {
  const rows = completeField().map((item) => ({ ...item, intPlayed: "2" }));
  expect(new Set(qualificationStatuses(rows).values())).toEqual(new Set(["provisional"]));
});
