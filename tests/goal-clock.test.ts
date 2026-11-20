import { expect, test } from "bun:test";
import { fmtGoalCaption } from "../src/format.ts";
import type { TimelineItem, WcEvent } from "../src/types.ts";

// Kickoff 19:00 UTC = 16:00 BRT.
const event = {
  idEvent: "1", strEvent: "Home vs Away", strHomeTeam: "Home", strAwayTeam: "Away",
  strTimestamp: "2026-06-20T19:00:00Z", dateEvent: "2026-06-20",
} as WcEvent;

const goalAt = (intTime: string): TimelineItem => ({
  intTime, strTimeline: "Goal", strTimelineDetail: null, strHome: "yes",
  strPlayer: "Someone", strTeam: "Home", idPlayer: "1", strAssist: null, strComment: null,
});
const clockOf = (intTime: string) => fmtGoalCaption(goalAt(intTime), event, null, "1 x 0").match(/🕒 (\S+ \S+) \(BRT\)/)?.[1];

test("goal clock: first-half goal is kickoff + minute", () => {
  expect(clockOf("30")).toBe("20/06, 16:30");
});

test("goal clock: second-half goal accounts for the 15-minute half-time break", () => {
  expect(clockOf("60")).toBe("20/06, 17:15");
});

test("goal clock: stoppage-time minute ('45+2') still gets a clock", () => {
  expect(clockOf("45+2")).toBe("20/06, 16:47");
  expect(clockOf("90+3")).toBe("20/06, 17:48");
});

test("goal clock: extra-time goal adds the break before extra time", () => {
  expect(clockOf("100")).toBe("20/06, 18:00");
});
