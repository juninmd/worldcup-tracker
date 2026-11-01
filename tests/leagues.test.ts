import { expect, test } from "bun:test";
import { extractRows, fmtLeagueTable, type LeagueTable } from "../src/leagues.ts";

test("extractRows: parses FotMob table rows accurately", () => {
  const sample = {
    table: [
      {
        data: {
          table: {
            all: [
              { idx: 1, name: "Flamengo", shortName: "Flamengo", played: 33, wins: 22, draws: 7, losses: 4, goalConDiff: 40, pts: 73 },
              { idx: 2, name: "Palmeiras", shortName: "Palmeiras", played: 33, wins: 20, draws: 10, losses: 3, goalConDiff: 34, pts: 70 },
            ],
          },
        },
      },
    ],
  };

  const rows = extractRows(sample);
  expect(rows.length).toBe(2);
  expect(rows[0].idx).toBe(1);
  expect(rows[0].shortName).toBe("Flamengo");
  expect(rows[0].pts).toBe(73);
  expect(rows[1].idx).toBe(2);
  expect(rows[1].shortName).toBe("Palmeiras");
  expect(rows[1].pts).toBe(70);
});

test("extractRows: returns empty array on invalid payload", () => {
  expect(extractRows({})).toEqual([]);
  expect(extractRows(null)).toEqual([]);
});

test("fmtLeagueTable: formats table rows in monospaced layout", () => {
  const table: LeagueTable = {
    league: "brasileirao",
    name: "Brasileirão Série A",
    season: "2026",
    rows: [
      { idx: 1, name: "Flamengo", shortName: "Flamengo", played: 33, wins: 22, draws: 7, losses: 4, scoresStr: "68-28", goalConDiff: 40, pts: 73 },
    ],
  };

  const out = fmtLeagueTable(table, 1);
  expect(out).toContain("Brasileirão Série A — Classificação");
  expect(out).toContain("Temporada: 2026");
  expect(out).toContain("`#   Time            J   V   E   D   SG  Pts`");
  expect(out).toContain("`1   Flamengo        33  22   7   4  +40   73`");
});

test("fmtLeagueTable: handles empty rows", () => {
  const table: LeagueTable = {
    league: "champions",
    name: "UEFA Champions League",
    rows: [],
  };
  const out = fmtLeagueTable(table);
  expect(out).toContain("Nenhuma informação de tabela disponível");
});
