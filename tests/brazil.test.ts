import { expect, test } from "bun:test";
import { calculateBrazilMetrics, fmtBrazilMetrics, type BrazilMatchMetricInput } from "../src/brazil.ts";
import type { WcEvent } from "../src/types.ts";

const event = (id: string, home: string, away: string, hs: number, as: number): WcEvent => ({
  idEvent: id, strEvent: `${home} vs ${away}`, dateEvent: "2026-06-20", strTimestamp: "2026-06-20T12:00:00Z",
  strStatus: "FT", strProgress: null, strHomeTeam: home, strAwayTeam: away,
  idHomeTeam: home, idAwayTeam: away, intHomeScore: String(hs), intAwayScore: String(as),
  strVenue: null, strLeague: "FIFA World Cup",
});

const inputs: BrazilMatchMetricInput[] = [
  {
    event: event("1", "Brazil", "Japan", 2, 1), cornersHome: 5, cornersAway: 2,
    shots: [
      { minute: "20", team: "Brazil", player: "A", x: 80, y: 40, outcome: "goal", zone: "box", xg: 0.4, clearChance: true, detail: "" },
      { minute: "40", team: "Brazil", player: "B", x: 70, y: 30, outcome: "saved", zone: "box", xg: 0.3, clearChance: true, detail: "" },
      { minute: "50", team: "Japan", player: "C", x: 75, y: 30, outcome: "goal", zone: "box", xg: 0.5, clearChance: true, detail: "" },
    ],
    cards: [{ intTime: "60", strPlayer: "A", strTeam: "Brazil", strHome: "yes", cardType: "yellow" }],
    goals: [
      { intTime: "20", strTimeline: "Goal", strTimelineDetail: null, strHome: "yes", strPlayer: "A", strTeam: "Brazil", idPlayer: null, strAssist: null, strComment: null },
      { intTime: "50", strTimeline: "Goal", strTimelineDetail: null, strHome: "no", strPlayer: "C", strTeam: "Japan", idPlayer: null, strAssist: null, strComment: null },
      { intTime: "80", strTimeline: "Goal", strTimelineDetail: null, strHome: "yes", strPlayer: "B", strTeam: "Brazil", idPlayer: null, strAssist: null, strComment: null },
    ],
    starters: ["A", "B", "C"],
  },
  {
    event: event("2", "Brazil", "Norway", 1, 2), cornersHome: 3, cornersAway: 6,
    shots: [
      { minute: "30", team: "Norway", player: "N", x: 85, y: 45, outcome: "goal", zone: "box", xg: 0.6, clearChance: true, detail: "" },
      { minute: "70", team: "Brazil", player: "A", x: 65, y: 30, outcome: "attempt", zone: "outside_box", xg: 0.1, clearChance: false, detail: "" },
    ], cards: [], goals: [], starters: ["A", "B", "D"],
  },
];

test("calculateBrazilMetrics: aggregates performance and lineup continuity", () => {
  const metrics = calculateBrazilMetrics(inputs);
  expect(metrics).toMatchObject({ played: 2, wins: 1, draws: 0, losses: 1, goalsFor: 3, goalsAgainst: 3 });
  expect(metrics.xgFor).toBe(0.8);
  expect(metrics.xgAgainst).toBe(1.1);
  expect(metrics.shotsFor).toBe(3);
  expect(metrics.shotsOnTargetFor).toBe(2);
  expect(metrics.yellowPer90).toBe(0.5);
  expect(metrics.lineupCoverage).toBe(1);
  expect(metrics.lineupContinuity).toBeCloseTo(2 / 3, 4);
});

test("fmtBrazilMetrics: labels estimated and partial data sources", () => {
  const out = fmtBrazilMetrics(calculateBrazilMetrics(inputs));
  expect(out).toContain("RAIO-X DO BRASIL");
  expect(out).toContain("xG estimado pelo tracker");
  expect(out).toContain("Finalizações");
  expect(out).toContain("Continuidade dos titulares");
  expect(out).toContain("Fonte: FIFA");
});
