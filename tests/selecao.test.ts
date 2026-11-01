import { expect, test } from "bun:test";
import { fmtSelecaoHub, formatBrt, parseTeamMatch, type SelecaoHubData } from "../src/selecao.ts";

test("formatBrt: converts UTC ISO string to Brazilian formatted date", () => {
  const formatted = formatBrt("2026-11-14T10:15:00.000Z");
  expect(formatted).toContain("14/11/2026");
  expect(formatted).toContain("07:15"); // UTC-3
});

test("parseTeamMatch: extracts match info correctly", () => {
  const raw = {
    opponent: { name: "Japan" },
    home: { id: 6715, name: "Japan" },
    away: { id: 8256, name: "Brazil" },
    tournament: { name: "Friendlies" },
    status: { utcTime: "2026-11-14T10:15:00.000Z", scoreStr: "1 - 2" },
  };

  const parsed = parseTeamMatch(raw);
  expect(parsed).not.toBeNull();
  expect(parsed?.opponent).toBe("Japan");
  expect(parsed?.isHome).toBe(false);
  expect(parsed?.tournament).toBe("Friendlies");
  expect(parsed?.scoreStr).toBe("1 - 2");
});

test("parseTeamMatch: returns null when input is empty", () => {
  expect(parseTeamMatch(null)).toBeNull();
  expect(parseTeamMatch(undefined)).toBeNull();
});

test("fmtSelecaoHub: formats complete Brasil hub message", () => {
  const data: SelecaoHubData = {
    nextMatch: {
      opponent: "Japan",
      isHome: false,
      tournament: "Amistoso",
      utcTime: "2026-11-14T10:15:00.000Z",
      brtTime: "14/11/2026 07:15",
    },
    lastMatch: {
      opponent: "India",
      isHome: false,
      tournament: "Amistoso",
      scoreStr: "0 - 4",
      utcTime: "2026-10-03T14:00:00.000Z",
      brtTime: "03/10/2026 11:00",
    },
    qualifiersRow: {
      idx: 5,
      name: "Brazil",
      shortName: "Brazil",
      played: 18,
      wins: 8,
      draws: 4,
      losses: 6,
      scoresStr: "24-17",
      goalConDiff: 7,
      pts: 28,
    },
    news: [
      {
        title: "Brasil convoca para amistosos",
        link: "https://ge.globo.com/1",
        summary: "Lista divulgada",
        pubDate: "Fri, 30 Oct 2026",
      },
    ],
  };

  const out = fmtSelecaoHub(data);
  expect(out).toContain("Seleção Brasileira — Hub 360°");
  expect(out).toContain("Japan x Brasil (Amistoso)");
  expect(out).toContain("vs India (Amistoso) — Placar: 0 - 4");
  expect(out).toContain("5º lugar · 28 pts");
  expect(out).toContain("Zona de vaga direta (G6)");
  expect(out).toContain("Brasil convoca para amistosos");
});
