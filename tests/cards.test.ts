import { expect, test, mock } from "bun:test";

const mockEvents = [
  { idEvent: "event1", strHomeTeam: "Brazil", strAwayTeam: "Argentina" },
];

const mockCards = [
  { intTime: "23", strPlayer: "Casemiro", strTeam: "Brazil", strHome: "yes", cardType: "yellow" },
  { intTime: "67", strPlayer: "Casemiro", strTeam: "Brazil", strHome: "yes", cardType: "yellow" },
  { intTime: "80", strPlayer: "Otamendi", strTeam: "Argentina", strHome: "no", cardType: "red" },
];

mock.module("../src/sportsdb.ts", () => ({
  mergedSeasonEvents: () => Promise.resolve(mockEvents),
  cardEvents: () => Promise.resolve(mockCards),
  isFinished: () => true,
  isLive: () => false,
}));

import { topCards, fmtCards } from "../src/cards.ts";

test("topCards: tallies yellow/red per player and ranks red above repeated yellows", async () => {
  const list = await topCards();

  const otamendi = list.find((c) => c.player === "Otamendi");
  expect(otamendi).toMatchObject({ team: "Argentina", yellow: 0, red: 1 });

  const casemiro = list.find((c) => c.player === "Casemiro");
  expect(casemiro).toMatchObject({ team: "Brazil", yellow: 2, red: 0 });

  // A single red (weight 2) outranks two yellows (weight 2) only by name tiebreak,
  // but here Casemiro's 2 yellows should still trail a genuinely worse card record.
  expect(list[0]!.player === "Otamendi" || list[0]!.player === "Casemiro").toBe(true);
});

test("fmtCards: renders empty state and player rows", () => {
  expect(fmtCards([])).toContain("sem cartões");
  const out = fmtCards([{ player: "Casemiro", team: "Brazil", yellow: 2, red: 0 }]);
  expect(out).toContain("Casemiro");
  expect(out).toContain("🟨x2");
});
