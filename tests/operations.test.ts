import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createOperationalRepository } from "../src/db.ts";

test("operational repository: summarizes availability, cache, stale fallback and latency", () => {
  const database = new Database(":memory:");
  const repository = createOperationalRepository(database);
  repository.record({ at: 1000, subsystem: "fifa", operation: "matches", outcome: "ok", latencyMs: 100 });
  repository.record({ at: 1100, subsystem: "fifa", operation: "matches", outcome: "cache", latencyMs: 2 });
  repository.record({ at: 1200, subsystem: "fifa", operation: "timeline", outcome: "stale", latencyMs: 500 });
  repository.record({ at: 1300, subsystem: "telegram", operation: "sendMessage", outcome: "error", latencyMs: 1000 });

  const metrics = repository.summary(0);
  expect(metrics).toMatchObject({ total: 4, errors: 1, cacheHits: 1, staleFallbacks: 1, successRate: 0.75 });
  expect(metrics.latencyP50Ms).toBe(100);
  expect(metrics.latencyP95Ms).toBe(1000);
  expect(metrics.bySubsystem.fifa!.total).toBe(3);
  expect(metrics.bySubsystem.telegram!.errors).toBe(1);
  database.close();
});

test("operational repository: empty window is explicit", () => {
  const database = new Database(":memory:");
  const metrics = createOperationalRepository(database).summary(Date.now());
  expect(metrics.total).toBe(0);
  expect(metrics.successRate).toBeNull();
  expect(metrics.latencyP95Ms).toBeNull();
  database.close();
});
