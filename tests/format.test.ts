import { expect, test } from "bun:test";
import { fmtDailyMenu, fmtFulltime, fmtGoalCaption, isUpset, youtubeSearchLink } from "../src/format.ts";
import type { Prediction, TimelineItem, WcEvent } from "../src/types.ts";

const basePred: Prediction = {
  homeGoals: 1, awayGoals: 2, pHome: 0.6, pDraw: 0.25, pAway: 0.15,
  eloHome: 1900, eloAway: 1700, playerQualityHome: 80, playerQualityAway: 60,
  strengthHome: 1950, strengthAway: 1720,
};

test("isUpset: favourite winning is not a zebra", () => {
  expect(isUpset(basePred, 2, 1)).toBe(false);
});

test("isUpset: underdog (pAway < 35%) winning away is a zebra", () => {
  expect(isUpset(basePred, 0, 1)).toBe(true);
});

test("isUpset: underdog (pHome < 35%) winning at home is a zebra", () => {
  const pred: Prediction = { ...basePred, pHome: 0.2, pAway: 0.55 };
  expect(isUpset(pred, 1, 0)).toBe(true);
});

test("isUpset: draw is never a zebra", () => {
  expect(isUpset(basePred, 1, 1)).toBe(false);
});

test("youtubeSearchLink: builds an encoded YouTube search URL", () => {
  const link = youtubeSearchLink("Brazil x Argentina melhores momentos");
  expect(link).toBe("https://www.youtube.com/results?search_query=Brazil%20x%20Argentina%20melhores%20momentos");
});

const dummyEvent = {
  idEvent: "1", strEvent: "Home vs Away", dateEvent: "2026-06-20", strTimestamp: "2026-06-20T19:00:00Z",
  strStatus: "FT", strProgress: null, strHomeTeam: "Home", strAwayTeam: "Away",
  idHomeTeam: "h", idAwayTeam: "a", intHomeScore: "1", intAwayScore: "0",
  strVenue: null, strLeague: "FIFA World Cup",
} as WcEvent;

test("fmtFulltime: flags a zebra with the underdog's model probability", () => {
  const pred: Prediction = { ...basePred, pHome: 0.2, pAway: 0.55 };
  const out = fmtFulltime(dummyEvent, pred, []);
  expect(out).toContain("ZEBRA");
  expect(out).toContain("Home venceu com apenas 20% de chance");
});

test("fmtFulltime: no zebra line when the favourite wins", () => {
  const out = fmtFulltime(dummyEvent, basePred, []);
  expect(out).not.toContain("ZEBRA");
});

test("fmtPrematch: distinguishes official ranking from versioned internal priors", async () => {
  const { fmtPrematch } = await import("../src/format.ts");
  const out = fmtPrematch(dummyEvent, { ...basePred, fifaRankHome: 6, fifaRankAway: 23 });
  expect(out).toContain("Ranking FIFA (11/06/2026)");
  expect(out).toContain("Modelo interno");
  expect(out).toContain("índice manual de elenco");
});

test("fmtFulltime: always includes a highlights search link (strVideo is never populated by the FIFA feed)", () => {
  const out = fmtFulltime(dummyEvent, basePred, []);
  expect(out).toContain("Melhores momentos");
  expect(out).toContain("youtube.com/results?search_query=");
});

test("fmtGoalCaption: includes goal-video and FIFA player-video search links", () => {
  const goal: TimelineItem = {
    intTime: "34", strTimeline: "Goal", strTimelineDetail: null, strHome: "yes",
    strPlayer: "Julian Quinones", strTeam: "Home", idPlayer: "1", strAssist: null, strComment: null,
  };
  const out = fmtGoalCaption(goal, dummyEvent, null, "1 x 0");
  expect(out).toContain("Vídeo do gol");
  expect(out).toContain("Vídeos do jogador");
  expect(out).toContain(encodeURIComponent("Julian Quinones").replace(/%20/g, "%20"));
});

test("fmtDailyMenu: an eliminated Brazil is history, not a next step or title favorite", () => {
  const loss = {
    round: "Oitavas", home: "Brazil", away: "Norway", winner: "Norway", real: true,
    prediction: { ...basePred, homeGoals: 1, awayGoals: 2, fifaRankHome: 6, fifaRankAway: 23 },
  };
  const out = fmtDailyMenu("2026-07-14", [], new Map(), [], [
    { team: "Spain", elo: 2100, playerQuality: 52, strength: 2152, prob: 1 },
  ], [], [loss]);
  expect(out).toContain("CAMPANHA DO BRASIL ENCERRADA");
  expect(out).toContain("1×2");
  expect(out).not.toContain("PRÓXIMOS PASSOS DO BRASIL");
  expect(out).not.toContain("Brasil vence");
  expect(out).toContain("Monte Carlo + chave atual");
});
