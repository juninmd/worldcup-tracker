import { expect, test } from "bun:test";
import { standingsChartUrl, tournamentCircleChartUrl, tournamentFlameChartUrl } from "../src/charts.ts";
import type { TournamentProjection, ProjectedMatch } from "../src/tournament.ts";
import type { TableRow } from "../src/types.ts";

const match = (round: string, home: string, away: string, winner: string, real = false): ProjectedMatch => ({
  round, home, away, winner, real,
  prediction: { homeGoals: 2, awayGoals: 1, pHome: 0.6, pDraw: 0.2, pAway: 0.2, eloHome: 2000, eloAway: 1900, playerQualityHome: 50, playerQualityAway: 30, strengthHome: 2050, strengthAway: 1930 },
});

const projection: TournamentProjection = {
  generatedAt: "2026-07-03T00:00:00Z",
  groups: new Map(),
  qualifiers: [],
  knockout: [
    [match("Semifinal", "Brazil", "Spain", "Brazil"), match("Semifinal", "France", "Argentina", "France")],
    [match("Final", "Brazil", "France", "Brazil")],
  ],
  champion: "Brazil",
  brazilPath: [],
};

test("tournamentCircleChartUrl: twopi layout, champion at center, all matches linked", () => {
  const url = tournamentCircleChartUrl(projection)!;
  expect(url).toContain("quickchart.io/graphviz");
  expect(url).toContain("layout=twopi");
  const dot = decodeURIComponent(url.split("graph=")[1]!);
  expect(dot).toContain("root=champ");
  expect(dot).toContain("Brazil");
  expect(dot).toContain("champ -> m1_0");
  expect(dot).toContain("m1_0 -> m0_0");
  expect(dot).toContain("m1_0 -> m0_1");
});

test("tournamentCircleChartUrl: null on empty knockout", () => {
  expect(tournamentCircleChartUrl({ ...projection, knockout: [] })).toBeNull();
});

test("tournamentFlameChartUrl still renders", () => {
  expect(tournamentFlameChartUrl(projection)).toContain("quickchart.io/graphviz");
});

test("standingsChartUrl: best eight thirds are green and eliminated thirds are grey", () => {
  const row = (group: string, team: string, points: number): TableRow => ({
    intRank: null, strTeam: team, strGroup: group, intPlayed: "3", intWin: null, intDraw: null, intLoss: null,
    intGoalsFor: "3", intGoalsAgainst: "2", intGoalDifference: "1", intPoints: String(points),
  });
  const rows = "ABCDEFGHIJKL".split("").flatMap((group, index) => [
    row(group, `${group}1`, 9), row(group, `${group}2`, 6), row(group, `${group}3`, 12 - index), row(group, `${group}4`, 0),
  ]);
  const config = JSON.parse(new URL(standingsChartUrl(rows)!).searchParams.get("c")!) as {
    data: { labels: string[]; datasets: { backgroundColor: string[] }[] };
  };
  const colors = config.data.datasets[0]!.backgroundColor;
  expect(colors[config.data.labels.indexOf("A3")]).toBe("#16a34a");
  expect(colors[config.data.labels.indexOf("L3")]).toBe("#94a3b8");
});
