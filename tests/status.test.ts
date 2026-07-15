import { expect, test } from "bun:test";
import { fmtOperationalStatus, type RuntimeStatus } from "../src/operations.ts";

const status: RuntimeStatus = {
  windowHours: 24,
  operations: {
    since: 0, total: 10, errors: 1, cacheHits: 3, staleFallbacks: 1,
    successRate: 0.9, latencyP50Ms: 20, latencyP95Ms: 200,
    bySubsystem: { telegram: { total: 2, errors: 0, cacheHits: 0, staleFallbacks: 0, successRate: 1, latencyP50Ms: 50, latencyP95Ms: 70 } },
  },
  cache: { entries: 5, newestAgeMs: 1000 },
  heartbeatAgeSeconds: 30,
  heartbeatStale: false,
  delivery: { trackedMatches: 2, expectedGoals: 5, postedGoals: 4, missingGoals: 1, duplicateKeys: 0 },
};

test("fmtOperationalStatus: exposes SLO signals without claiming end-to-end latency", () => {
  const out = fmtOperationalStatus(status);
  expect(out).toContain("SAÚDE OPERACIONAL");
  expect(out).toContain("p50 20ms · p95 200ms");
  expect(out).toContain("fallback stale *1*");
  expect(out).toContain("1 alerta(s) de gol pendente(s)");
  expect(out).toContain("Latência após detecção");
  expect(out).not.toContain("FIFA→Telegram");
});
