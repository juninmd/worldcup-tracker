import { afterAll, expect, mock, test } from "bun:test";

// Two live matches: A has a goal whose player cutout Telegram rejects,
// B has a card. A failure in A must not freeze B, and A's goal must still land as text.
const live = (id: string, home: string, away: string) => ({
  idEvent: id, strHomeTeam: home, strAwayTeam: away, strStatus: "1H", dateEvent: "2026-06-20",
});
const A = live("A", "Brazil", "Serbia");
const B = live("B", "France", "Peru");

const sent: string[] = [];
const state = {
  prematchPosted: ["A", "B"], fulltimePosted: [], postedGoals: [] as string[], postedSubs: [],
  postedVar: [], postedCards: [] as string[], postedUpcomingAlert: [], postedAnalysis: [],
};

// bun's module mocks outlive this file, so fakes only apply while this test runs.
let active = true;
type Fn = (...args: any[]) => any;
const gate = <T extends Record<string, unknown>>(real: T, fakes: Record<string, Fn>) => {
  const out: Record<string, unknown> = { ...real };
  for (const [k, fake] of Object.entries(fakes)) {
    out[k] = (...args: unknown[]) => (active ? fake(...args) : (real[k] as Fn)(...args));
  }
  return out;
};

const realDb = { ...(await import("../src/sportsdb.ts")) };
mock.module("../src/sportsdb.ts", () => gate(realDb, {
  seasonEvents: async () => [A, B],
  eventsByDay: async () => [],
  eventDetail: async (id: string) => (id === "A" ? A : B),
  isLive: () => true,
  isFinished: () => false,
  timeline: async (id: string) => id === "A"
    ? [{ strTimeline: "Goal", strTimelineDetail: "Normal Goal", strPlayer: "Vini", idPlayer: "9", strTeam: "Brazil", strHome: "yes", intTime: "10" }]
    : [],
  substitutionEvents: async () => [],
  varIncidents: async () => [],
  cardEvents: async (id: string) => id === "B"
    ? [{ idTimeline: "c1", intTime: "20", strPlayer: "Mbappe", strTeam: "France", cardType: "yellow" }]
    : [],
  findPlayerById: async () => ({ strPlayer: "Vini", strCutout: "https://bad.example/cutout.png" }),
}));
const realTg = { ...(await import("../src/telegram.ts")) };
mock.module("../src/telegram.ts", () => gate(realTg, {
  sendMessage: async (text: string) => { sent.push(text); },
  sendPhotoStrict: async () => { throw new Error("Bad Request: wrong file identifier/HTTP URL specified"); },
  sendPhoto: async (_url: string, caption: string) => { sent.push(caption); },
}));
const realState = { ...(await import("../src/state.ts")) };
mock.module("../src/state.ts", () => gate(realState, { loadState: async () => state, saveState: async () => {} }));

const { pollOnce } = await import("../src/engine.ts");
afterAll(() => { active = false; });

test("pollOnce: a rejected goal photo neither aborts the pass nor drops the goal", async () => {
  expect(await pollOnce()).toBe(2);
  expect(state.postedGoals).toEqual(["A:H:1"]);
  expect(sent.some((m) => m.includes("Vini"))).toBe(true);
  expect(state.postedCards).toEqual(["B:c1"]);
});
