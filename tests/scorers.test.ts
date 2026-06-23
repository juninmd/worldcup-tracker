import { expect, test, mock } from "bun:test";

const mockEvents = [
  {
    idEvent: "event1",
    strHomeTeam: "Brazil",
    strAwayTeam: "Argentina",
  }
];

const mockTimeline = [
  // Normal goal
  {
    strTimeline: "Goal",
    strTimelineDetail: "Normal Goal",
    strPlayer: "Neymar",
    strTeam: "Brazil",
  },
  // Own Goal
  {
    strTimeline: "Goal",
    strTimelineDetail: "Own Goal",
    strPlayer: "Otamendi",
    strTeam: "Argentina", // Otamendi scored in his own net
  },
  // Penalty goal
  {
    strTimeline: "Goal",
    strTimelineDetail: "Penalty",
    strPlayer: "Messi",
    strTeam: "Argentina",
  },
  // Disallowed goal
  {
    strTimeline: "Goal",
    strTimelineDetail: "disallowed",
    strPlayer: "Messi",
    strTeam: "Argentina",
  }
];

mock.module("../src/sportsdb.ts", () => ({
  seasonEvents: () => Promise.resolve(mockEvents),
  timeline: () => Promise.resolve(mockTimeline),
  isFinished: () => true,
  isLive: () => false,
  findPlayer: () => Promise.resolve(null),
}));

import { topScorers } from "../src/scorers.ts";

test("topScorers: tallies correctly and filters out own goals / disallowed goals", async () => {
  const list = await topScorers();

  // Neymar should have 1 goal
  const neymar = list.find((s) => s.player === "Neymar");
  expect(neymar).toBeDefined();
  expect(neymar!.goals).toBe(1);
  expect(neymar!.team).toBe("Brazil");

  // Messi should have 1 goal (penalty counts, disallowed does not)
  const messi = list.find((s) => s.player === "Messi");
  expect(messi).toBeDefined();
  expect(messi!.goals).toBe(1);
  expect(messi!.team).toBe("Argentina");

  // Otamendi should NOT be in the scorers list at all because it was an own goal!
  const otamendi = list.find((s) => s.player === "Otamendi");
  expect(otamendi).toBeUndefined();
});
