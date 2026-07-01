import { expect, test } from "bun:test";
import { mapFifaMatch, mapFifaPlayer, mapFifaTimelineEvent } from "../src/sportsdb.ts";
import { fmtLineup } from "../src/details.ts";
import type { LineupPlayer, WcEvent } from "../src/types.ts";

test("mapFifaMatch: maps official FIFA match payload to WcEvent", () => {
  const event = mapFifaMatch({
    IdMatch: "400021443",
    IdCompetition: "17",
    IdSeason: "285023",
    Date: "2026-06-11T19:00:00Z",
    LocalDate: "2026-06-11T13:00:00Z",
    Home: {
      Score: 2,
      IdTeam: "43911",
      IdCountry: "MEX",
      ShortClubName: "Mexico",
      PictureUrl: "https://api.fifa.com/api/v3/picture/flags-{format}-{size}/MEX",
      TeamName: [{ Locale: "en-GB", Description: "Mexico" }],
    },
    Away: {
      Score: 0,
      IdTeam: "43883",
      IdCountry: "RSA",
      ShortClubName: "South Africa",
      PictureUrl: "https://api.fifa.com/api/v3/picture/flags-{format}-{size}/RSA",
      TeamName: [{ Locale: "en-GB", Description: "South Africa" }],
    },
    HomeTeamScore: 2,
    AwayTeamScore: 0,
    MatchStatus: 0,
    MatchTime: "98'",
    MatchNumber: 1,
    GroupName: [{ Locale: "en-GB", Description: "Group A" }],
    Stadium: {
      Name: [{ Locale: "en-GB", Description: "Mexico City Stadium" }],
      CityName: [{ Locale: "en-GB", Description: "Mexico City" }],
      IdCountry: "MEX",
    },
  });

  expect(event).toMatchObject({
    idEvent: "400021443",
    strHomeTeam: "Mexico",
    strAwayTeam: "South Africa",
    intHomeScore: "2",
    intAwayScore: "0",
    strStatus: "FT",
    strVenue: "Mexico City Stadium",
    strGroup: "Group A",
  });
  expect(event.strStage).toBeNull();
  expect(event.strPlaceHolderA).toBeNull();
  expect(event.strPlaceHolderB).toBeNull();
  expect(event.strHomeTeamBadge).toContain("flags-png-4/MEX");
});

test("mapFifaMatch: preserves official stage and placeholders for knockout", () => {
  const event = mapFifaMatch({
    IdMatch: "400021091",
    IdCompetition: "17",
    IdSeason: "285023",
    Date: "2026-07-04T21:00:00Z",
    Home: null,
    Away: null,
    HomeTeamScore: null,
    AwayTeamScore: null,
    MatchStatus: 1,
    MatchNumber: 89,
    PlaceHolderA: "W74",
    PlaceHolderB: "W77",
    GroupName: [],
    StageName: [{ Locale: "en-GB", Description: "Round of 16" }],
    Stadium: null,
  });

  expect(event.strHomeTeam).toBe("W74");
  expect(event.strAwayTeam).toBe("W77");
  expect(event.strStage).toBe("Round of 16");
  expect(event.strPlaceHolderA).toBe("W74");
  expect(event.strPlaceHolderB).toBe("W77");
  expect(event.intRound).toBe("89");
});

test("mapFifaTimelineEvent: extracts goal scorer from FIFA timeline", () => {
  const event = {
    idHomeTeam: "43911",
    idAwayTeam: "43883",
    strHomeTeam: "Mexico",
    strAwayTeam: "South Africa",
  } as WcEvent;

  const item = mapFifaTimelineEvent({
    EventId: "61216779",
    IdTeam: "43911",
    IdPlayer: "429157",
    MatchMinute: "9'",
    Type: 0,
    TypeLocalized: [{ Locale: "en-GB", Description: "Goal!" }],
    EventDescription: [{ Locale: "en-GB", Description: "Julian QUINONES (Mexico) scores!!" }],
  }, event);

  expect(item).toMatchObject({
    idTimeline: "61216779",
    intTime: "9",
    strTimeline: "Goal",
    strHome: "yes",
    strPlayer: "Julian Quinones",
    strTeam: "Mexico",
  });
});

test("mapFifaTimelineEvent: counts own goal for opposite side", () => {
  const event = {
    idHomeTeam: "43921",
    idAwayTeam: "43928",
    strHomeTeam: "USA",
    strAwayTeam: "Paraguay",
  } as WcEvent;

  const item = mapFifaTimelineEvent({
    EventId: "own1",
    IdTeam: "43928",
    IdPlayer: "123",
    MatchMinute: "7'",
    Type: 34,
    TypeLocalized: [{ Locale: "en-GB", Description: "Own goal" }],
    EventDescription: [{ Locale: "en-GB", Description: "Damian BOBADILLA (Paraguay) scores an own goal." }],
  }, event);

  expect(item).toMatchObject({
    strTimelineDetail: "Own goal",
    strHome: "yes",
    strPlayer: "Damian Bobadilla",
    strTeam: "USA",
  });
});

test("mapFifaTimelineEvent: counts penalty goal", () => {
  const event = {
    idHomeTeam: "43834",
    idAwayTeam: "43971",
    strHomeTeam: "Qatar",
    strAwayTeam: "Switzerland",
  } as WcEvent;

  const item = mapFifaTimelineEvent({
    EventId: "pen1",
    IdTeam: "43971",
    IdPlayer: "456",
    MatchMinute: "17'",
    Type: 41,
    TypeLocalized: [{ Locale: "en-GB", Description: "Penalty Goal" }],
    EventDescription: [{ Locale: "en-GB", Description: "Breel EMBOLO (Switzerland) successfully converts the penalty!" }],
  }, event);

  expect(item).toMatchObject({
    strTimelineDetail: "Penalty Goal",
    strHome: "no",
    strPlayer: "Breel Embolo",
    strTeam: "Switzerland",
  });
});

test("mapFifaPlayer: maps official FIFA squad player with media", () => {
  const player = mapFifaPlayer({
    IdTeam: "43921",
    IdPlayer: "448217",
    PlayerName: [{ Locale: "en-GB", Description: "Matt TURNER" }],
    JerseyNum: 1,
    BirthDate: "1994-06-24T00:00:00Z",
    Height: 190,
    Weight: 79,
    IdCountry: "USA",
    PositionLocalized: [{ Locale: "en-GB", Description: "Goalkeeper" }],
    PlayerPicture: { PictureUrl: "https://digitalhub.fifa.com/transform/turner" },
  }, "USA");

  expect(player).toMatchObject({
    strPlayer: "Matt Turner",
    strTeam: "USA",
    strPosition: "Goalkeeper",
    strNumber: "1",
    strNationality: "USA",
    dateBorn: "1994-06-24",
    strThumb: "https://digitalhub.fifa.com/transform/turner",
  });
  expect(player.strDescriptionEN).toContain("Altura: 190cm");
});

test("fmtLineup: labels FIFA roster when starters are not published", () => {
  const event = {
    strHomeTeam: "USA",
    strAwayTeam: "Australia",
  } as WcEvent;
  const players: LineupPlayer[] = [
    { strPlayer: "Matt Turner", strPosition: "Goalkeeper", strSubstitute: "Yes", strHome: "Yes", intSquadNumber: "1" },
    { strPlayer: "Mat Ryan", strPosition: "Goalkeeper", strSubstitute: "Yes", strHome: "No", intSquadNumber: "1" },
  ];

  const out = fmtLineup(event, players);

  expect(out).toContain("ELENCOS OFICIAIS FIFA");
  expect(out).toContain("Elenco:");
  expect(out).toContain("FIFA ainda não publicou XI inicial");
});
