import { expect, test } from "bun:test";
import { WC2030, fmtCycle2030, roadTo2030, squadHorizon } from "../src/cycle2030.ts";
import type { Player } from "../src/types.ts";

const player = (name: string, dateBorn: string | null, position = "Forward"): Player => ({
  strPlayer: name, strTeam: "Brazil", strPosition: position, strNumber: null,
  strNationality: "BRA", dateBorn, strThumb: null, strCutout: null, strDescriptionEN: null,
});

const OPENER = new Date(WC2030.openerUtc);

test("roadTo2030: only future milestones, nearest first", () => {
  const road = roadTo2030(new Date("2028-01-01T00:00:00Z"));
  expect(road.map((m) => m.label)).toEqual([
    "Copa América 2028",
    "Eliminatórias UEFA/CAF começam",
    "Sorteio dos grupos",
    "Abertura: jogo do centenário em Montevidéu",
  ]);
  expect(road[0]!.days).toBe(152);
});

test("roadTo2030: on opening day only the opener remains, at zero days", () => {
  const road = roadTo2030(OPENER);
  expect(road).toHaveLength(1);
  expect(road[0]!.confirmed).toBe(true);
  expect(road[0]!.days).toBe(0);
});

test("squadHorizon: buckets by age at the 2030 opener", () => {
  const horizon = squadHorizon([
    player("Jovem", "2008-01-01"), // 22
    player("Nucleo", "2002-01-01"), // 28
    player("Limite", "1998-06-09"), // 31 — birthday one day after the opener
    player("Tardio", "1997-01-01"), // 33
    player("Veterano", "1994-01-01"), // 36
  ], "Brasil");
  expect(horizon.prospects.map((p) => p.name)).toEqual(["Jovem"]);
  expect(horizon.core.map((p) => p.name)).toEqual(["Nucleo", "Limite"]);
  expect(horizon.late.map((p) => p.name)).toEqual(["Tardio"]);
  expect(horizon.fading.map((p) => p.name)).toEqual(["Veterano"]);
  expect(horizon.core.find((p) => p.name === "Limite")!.age).toBe(31);
  expect(horizon.sized).toBe(5);
  expect(horizon.avgAge).toBe(30);
  expect(horizon.atDate).toBe(WC2030.openerDate);
});

test("squadHorizon: players without a usable birth date are excluded, not aged as 0", () => {
  const horizon = squadHorizon([
    player("Sem data", null),
    player("Data quebrada", "not-a-date"),
    player("Valido", "2002-01-01"),
  ], "Brasil");
  expect(horizon.sized).toBe(1);
  expect(horizon.avgAge).toBe(28);
});

test("squadHorizon: empty squad does not produce NaN", () => {
  const horizon = squadHorizon([], "Brasil");
  expect(horizon.sized).toBe(0);
  expect(horizon.avgAge).toBe(0);
});

test("fmtCycle2030: countdown, projected-date marker and squad block", () => {
  const from = new Date("2026-07-26T12:00:00Z");
  const msg = fmtCycle2030(roadTo2030(from), squadHorizon([player("Nucleo", "2002-01-01")], "Brasil"), from);
  expect(msg).toContain("1.413 dias");
  expect(msg).toContain("_(previsto)_"); // qualifier dates are projections, flagged as such
  expect(msg).toContain("09/2027 _(previsto)_ — Eliminatórias CONMEBOL começam");
  expect(msg).toContain("08/06/2030 — Abertura");
  expect(msg).toContain("(1 jogador, média 28 anos)");
  expect(msg).toContain("No auge (24–31): 1 — Nucleo (28)");
});

test("fmtCycle2030: survives a missing squad feed", () => {
  const from = new Date("2026-07-26T12:00:00Z");
  const msg = fmtCycle2030(roadTo2030(from), null, from);
  expect(msg).toContain("CICLO 2030");
  expect(msg).not.toContain("No auge");
});
