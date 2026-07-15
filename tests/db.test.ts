import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createPredictionRepository, type PredictionSnapshotInput } from "../src/db.ts";

const input: PredictionSnapshotInput = {
  eventId: "m1", modelVersion: "v1", predictedAt: 1000, source: "daily_menu",
  kickoffAt: "2026-06-20T19:00:00Z", home: "Brazil", away: "Norway",
  pHome: 0.6, pDraw: 0.25, pAway: 0.15, predictedHome: 2, predictedAway: 1,
  eloHome: 2000, eloAway: 1900, playerQualityHome: 50, playerQualityAway: 26,
  strengthHome: 2050, strengthAway: 1926,
  fifaRankHome: 6, fifaRankAway: 23,
};

test("prediction repository: first snapshot is immutable and settlement adds the result", () => {
  const database = new Database(":memory:");
  const repository = createPredictionRepository(database);
  expect(repository.put(input)).toBe(true);
  expect(repository.put({ ...input, pHome: 0.1, predictedAt: 2000 })).toBe(false);
  expect(repository.get("m1", "v1")?.pHome).toBe(0.6);

  repository.settle("m1", 1, 2);
  expect(repository.evaluated("v1")).toEqual([expect.objectContaining({
    eventId: "m1", actualHome: 1, actualAway: 2, pHome: 0.6,
  })]);
  database.close();
});

test("prediction repository: model versions retain independent snapshots", () => {
  const database = new Database(":memory:");
  const repository = createPredictionRepository(database);
  repository.put(input);
  repository.put({ ...input, modelVersion: "v2", pHome: 0.55 });
  expect(repository.count()).toBe(2);
  database.close();
});
