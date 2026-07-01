import { expect, test } from "bun:test";
import { mapFifaCardEvent, intensityBuckets } from "../src/sportsdb.ts";
import type { WcEvent } from "../src/types.ts";

const event = {
  idHomeTeam: "43911",
  idAwayTeam: "43883",
  strHomeTeam: "Mexico",
  strAwayTeam: "South Africa",
} as WcEvent;

test("mapFifaCardEvent: extracts a yellow card and its recipient", () => {
  const card = mapFifaCardEvent({
    EventId: "yc1",
    IdTeam: "43911",
    IdPlayer: "1",
    MatchMinute: "34'",
    Type: 2,
    TypeLocalized: [{ Locale: "en-GB", Description: "Yellow Card" }],
    EventDescription: [{ Locale: "en-GB", Description: "Edson ALVAREZ (Mexico) is booked." }],
  }, event);

  expect(card).toMatchObject({
    intTime: "34",
    strPlayer: "Edson Alvarez",
    strTeam: "Mexico",
    strHome: "yes",
    cardType: "yellow",
  });
});

test("mapFifaCardEvent: extracts a red card for the away side", () => {
  const card = mapFifaCardEvent({
    EventId: "rc1",
    IdTeam: "43883",
    IdPlayer: "2",
    MatchMinute: "80'",
    Type: 3,
    TypeLocalized: [{ Locale: "en-GB", Description: "Red Card" }],
    EventDescription: [{ Locale: "en-GB", Description: "Ronwen WILLIAMS (South Africa) is sent off." }],
  }, event);

  expect(card).toMatchObject({ strHome: "no", cardType: "red", strPlayer: "Ronwen Williams" });
});

test("mapFifaCardEvent: ignores non-card timeline events", () => {
  const item = mapFifaCardEvent({
    EventId: "g1",
    IdTeam: "43911",
    MatchMinute: "9'",
    Type: 0,
    TypeLocalized: [{ Locale: "en-GB", Description: "Goal!" }],
    EventDescription: [{ Locale: "en-GB", Description: "Julian QUINONES (Mexico) scores!!" }],
  }, event);
  expect(item).toBeNull();
});

test("intensityBuckets: buckets timestamped events into 15-minute periods per side", () => {
  const items = [
    { IdTeam: "43911", MatchMinute: "10'", TypeLocalized: [{ Locale: "en-GB", Description: "Corner" }] },
    { IdTeam: "43911", MatchMinute: "12'", TypeLocalized: [{ Locale: "en-GB", Description: "Attempt at Goal" }] },
    { IdTeam: "43883", MatchMinute: "50'", TypeLocalized: [{ Locale: "en-GB", Description: "Foul" }] },
    { IdTeam: "43883", MatchMinute: "95'", TypeLocalized: [{ Locale: "en-GB", Description: "Yellow Card" }] },
    { IdTeam: "43911", MatchMinute: "10'", TypeLocalized: [{ Locale: "en-GB", Description: "Ball Possession" }] },
  ];

  const buckets = intensityBuckets(items as never, event);

  expect(buckets.map((b) => b.label)).toEqual(["0-15", "16-30", "31-45", "46-60", "61-75", "76+"]);
  expect(buckets[0]).toMatchObject({ label: "0-15", home: 2, away: 0 });
  expect(buckets[3]).toMatchObject({ label: "46-60", home: 0, away: 1 });
  expect(buckets[5]).toMatchObject({ label: "76+", home: 0, away: 1 });
});
