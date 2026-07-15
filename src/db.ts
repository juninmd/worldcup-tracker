import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MODEL_VERSION } from "./elo.ts";
import type { EvaluatedPrediction } from "./metrics.ts";
import type { Prediction, WcEvent } from "./types.ts";

// Lives on the same PVC as state.json (/app/data in the cluster), so the cache
// survives pod restarts — the app can serve last-known data without hitting the
// rate-limited free API on every boot.
const FILE = new URL("../data/wc.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let _db: Database | null = null;
function ensureSchema(d: Database): void {
  d.exec(`CREATE TABLE IF NOT EXISTS api_cache (
    path       TEXT PRIMARY KEY,
    body       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );`);
  d.exec(`CREATE TABLE IF NOT EXISTS prediction_snapshots (
    event_id       TEXT NOT NULL,
    model_version  TEXT NOT NULL,
    predicted_at   INTEGER NOT NULL,
    source         TEXT NOT NULL,
    kickoff_at     TEXT,
    home           TEXT NOT NULL,
    away           TEXT NOT NULL,
    p_home         REAL NOT NULL,
    p_draw         REAL NOT NULL,
    p_away         REAL NOT NULL,
    predicted_home INTEGER NOT NULL,
    predicted_away INTEGER NOT NULL,
    elo_home       INTEGER NOT NULL,
    elo_away       INTEGER NOT NULL,
    quality_home   INTEGER NOT NULL,
    quality_away   INTEGER NOT NULL,
    strength_home  INTEGER NOT NULL,
    strength_away  INTEGER NOT NULL,
    fifa_rank_home INTEGER,
    fifa_rank_away INTEGER,
    actual_home    INTEGER,
    actual_away    INTEGER,
    PRIMARY KEY (event_id, model_version)
  );`);
  d.exec(`CREATE TABLE IF NOT EXISTS operational_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    subsystem   TEXT NOT NULL,
    operation   TEXT NOT NULL,
    outcome     TEXT NOT NULL,
    latency_ms  INTEGER NOT NULL
  );`);
  d.exec("CREATE INDEX IF NOT EXISTS idx_operational_events_at ON operational_events(at);");
}

function db(): Database {
  if (_db) return _db;
  // Some workloads (e.g. the daily-menu CronJob) run without the PVC mounted;
  // fall back to an in-memory cache so a missing/read-only dir never crashes.
  let d: Database;
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    d = new Database(FILE, { create: true });
  } catch {
    d = new Database(":memory:");
  }
  // The CronJob shares this file with the tracker pod (same PVC); wait on a lock
  // instead of throwing SQLITE_BUSY when both write concurrently.
  d.exec("PRAGMA busy_timeout = 5000;");
  try {
    d.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // Another process can hold the SQLite file during startup. Cache is best-effort;
    // keep running with the default journal mode instead of failing the alert job.
  }
  ensureSchema(d);
  _db = d;
  return d;
}

export interface PredictionSnapshotInput {
  eventId: string;
  modelVersion: string;
  predictedAt: number;
  source: "daily_menu" | "prematch" | "manual";
  kickoffAt: string | null;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  predictedHome: number;
  predictedAway: number;
  eloHome: number;
  eloAway: number;
  playerQualityHome: number;
  playerQualityAway: number;
  strengthHome: number;
  strengthAway: number;
  fifaRankHome?: number;
  fifaRankAway?: number;
}

export interface PredictionSnapshot extends PredictionSnapshotInput {
  actualHome: number | null;
  actualAway: number | null;
}

export function createPredictionRepository(database: Database) {
  ensureSchema(database);
  const fromRow = (row: Record<string, unknown> | null): PredictionSnapshot | null => row ? {
    eventId: String(row.event_id), modelVersion: String(row.model_version), predictedAt: Number(row.predicted_at),
    source: String(row.source) as PredictionSnapshotInput["source"], kickoffAt: row.kickoff_at ? String(row.kickoff_at) : null,
    home: String(row.home), away: String(row.away), pHome: Number(row.p_home), pDraw: Number(row.p_draw), pAway: Number(row.p_away),
    predictedHome: Number(row.predicted_home), predictedAway: Number(row.predicted_away),
    eloHome: Number(row.elo_home), eloAway: Number(row.elo_away),
    playerQualityHome: Number(row.quality_home), playerQualityAway: Number(row.quality_away),
    strengthHome: Number(row.strength_home), strengthAway: Number(row.strength_away),
    fifaRankHome: row.fifa_rank_home === null ? undefined : Number(row.fifa_rank_home),
    fifaRankAway: row.fifa_rank_away === null ? undefined : Number(row.fifa_rank_away),
    actualHome: row.actual_home === null ? null : Number(row.actual_home),
    actualAway: row.actual_away === null ? null : Number(row.actual_away),
  } : null;
  return {
    put(input: PredictionSnapshotInput): boolean {
      const result = database.query(`INSERT OR IGNORE INTO prediction_snapshots (
        event_id, model_version, predicted_at, source, kickoff_at, home, away,
        p_home, p_draw, p_away, predicted_home, predicted_away,
        elo_home, elo_away, quality_home, quality_away, strength_home, strength_away,
        fifa_rank_home, fifa_rank_away
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.eventId, input.modelVersion, input.predictedAt, input.source, input.kickoffAt, input.home, input.away,
        input.pHome, input.pDraw, input.pAway, input.predictedHome, input.predictedAway,
        input.eloHome, input.eloAway, input.playerQualityHome, input.playerQualityAway, input.strengthHome, input.strengthAway,
        input.fifaRankHome ?? null, input.fifaRankAway ?? null,
      );
      return Number(result.changes) === 1;
    },
    get(eventId: string, modelVersion = MODEL_VERSION): PredictionSnapshot | null {
      return fromRow(database.query("SELECT * FROM prediction_snapshots WHERE event_id = ? AND model_version = ?").get(eventId, modelVersion) as Record<string, unknown> | null);
    },
    settle(eventId: string, actualHome: number, actualAway: number): void {
      database.query("UPDATE prediction_snapshots SET actual_home = ?, actual_away = ? WHERE event_id = ?").run(actualHome, actualAway, eventId);
    },
    evaluated(modelVersion = MODEL_VERSION): EvaluatedPrediction[] {
      const rows = database.query(`SELECT * FROM prediction_snapshots
        WHERE model_version = ? AND actual_home IS NOT NULL AND actual_away IS NOT NULL
        ORDER BY predicted_at`).all(modelVersion) as Record<string, unknown>[];
      return rows.map((row) => {
        const value = fromRow(row)!;
        return { ...value, actualHome: value.actualHome!, actualAway: value.actualAway! };
      });
    },
    count(): number {
      return Number((database.query("SELECT COUNT(*) AS count FROM prediction_snapshots").get() as { count: number }).count);
    },
  };
}

const predictions = () => createPredictionRepository(db());

export function savePredictionSnapshot(event: WcEvent, prediction: Prediction, source: PredictionSnapshotInput["source"]): boolean {
  return predictions().put({
    eventId: event.idEvent, modelVersion: MODEL_VERSION, predictedAt: Date.now(), source,
    kickoffAt: event.strTimestamp, home: event.strHomeTeam, away: event.strAwayTeam,
    pHome: prediction.pHome, pDraw: prediction.pDraw, pAway: prediction.pAway,
    predictedHome: prediction.homeGoals, predictedAway: prediction.awayGoals,
    eloHome: prediction.eloHome, eloAway: prediction.eloAway,
    playerQualityHome: prediction.playerQualityHome, playerQualityAway: prediction.playerQualityAway,
    strengthHome: prediction.strengthHome, strengthAway: prediction.strengthAway,
    fifaRankHome: prediction.fifaRankHome, fifaRankAway: prediction.fifaRankAway,
  });
}

export function predictionSnapshot(eventId: string): PredictionSnapshot | null {
  return predictions().get(eventId);
}

export function predictionFromSnapshot(snapshot: PredictionSnapshot): Prediction {
  return {
    homeGoals: snapshot.predictedHome, awayGoals: snapshot.predictedAway,
    pHome: snapshot.pHome, pDraw: snapshot.pDraw, pAway: snapshot.pAway,
    eloHome: snapshot.eloHome, eloAway: snapshot.eloAway,
    playerQualityHome: snapshot.playerQualityHome, playerQualityAway: snapshot.playerQualityAway,
    strengthHome: snapshot.strengthHome, strengthAway: snapshot.strengthAway,
    fifaRankHome: snapshot.fifaRankHome, fifaRankAway: snapshot.fifaRankAway,
  };
}

export function settlePredictionSnapshot(event: WcEvent): void {
  const home = Number(event.intHomeScore), away = Number(event.intAwayScore);
  if (!Number.isNaN(home) && !Number.isNaN(away)) predictions().settle(event.idEvent, home, away);
}

export function evaluatedPredictionSnapshots(): EvaluatedPrediction[] {
  return predictions().evaluated();
}

export type OperationalOutcome = "ok" | "cache" | "stale" | "error";
export interface OperationalEvent {
  at: number;
  subsystem: "fifa" | "telegram" | "poll";
  operation: string;
  outcome: OperationalOutcome;
  latencyMs: number;
}

export interface OperationalSlice {
  total: number;
  errors: number;
  cacheHits: number;
  staleFallbacks: number;
  successRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

export interface OperationalSummary extends OperationalSlice {
  since: number;
  bySubsystem: Record<string, OperationalSlice>;
}

const percentile = (values: number[], quantile: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
};

const operationSlice = (events: OperationalEvent[]): OperationalSlice => {
  const errors = events.filter((event) => event.outcome === "error").length;
  return {
    total: events.length,
    errors,
    cacheHits: events.filter((event) => event.outcome === "cache").length,
    staleFallbacks: events.filter((event) => event.outcome === "stale").length,
    successRate: events.length ? Number(((events.length - errors) / events.length).toFixed(4)) : null,
    latencyP50Ms: percentile(events.map((event) => event.latencyMs), 0.5),
    latencyP95Ms: percentile(events.map((event) => event.latencyMs), 0.95),
  };
};

export function createOperationalRepository(database: Database) {
  ensureSchema(database);
  return {
    record(event: OperationalEvent): void {
      database.query("INSERT INTO operational_events (at, subsystem, operation, outcome, latency_ms) VALUES (?, ?, ?, ?, ?)")
        .run(event.at, event.subsystem, event.operation, event.outcome, Math.max(0, Math.round(event.latencyMs)));
    },
    summary(since: number): OperationalSummary {
      const rows = database.query("SELECT at, subsystem, operation, outcome, latency_ms FROM operational_events WHERE at >= ? ORDER BY at")
        .all(since) as { at: number; subsystem: OperationalEvent["subsystem"]; operation: string; outcome: OperationalOutcome; latency_ms: number }[];
      const events = rows.map((row): OperationalEvent => ({ ...row, latencyMs: row.latency_ms }));
      const bySubsystem: Record<string, OperationalSlice> = {};
      for (const subsystem of new Set(events.map((event) => event.subsystem))) {
        bySubsystem[subsystem] = operationSlice(events.filter((event) => event.subsystem === subsystem));
      }
      return { since, ...operationSlice(events), bySubsystem };
    },
  };
}

const operations = () => createOperationalRepository(db());
let lastOperationPrune = 0;

export function recordOperationalEvent(event: Omit<OperationalEvent, "at"> & { at?: number }): void {
  try {
    const now = event.at ?? Date.now();
    operations().record({ ...event, at: now });
    if (now - lastOperationPrune >= 3_600_000) {
      db().query("DELETE FROM operational_events WHERE at < ?").run(now - 7 * 86_400_000);
      lastOperationPrune = now;
    }
  } catch {
    // Telemetry is best-effort and must never interrupt alerts or polling.
  }
}

export function operationalSummary(hours = 24): OperationalSummary {
  return operations().summary(Date.now() - hours * 3_600_000);
}

/** Cached raw response body for an API path, with its age in ms (null = miss). */
export function cacheGet(path: string): { body: string; age: number } | null {
  const row = db()
    .query("SELECT body, fetched_at FROM api_cache WHERE path = ?")
    .get(path) as { body: string; fetched_at: number } | null;
  if (!row) return null;
  return { body: row.body, age: Date.now() - row.fetched_at };
}

export function cachePut(path: string, body: string): void {
  db()
    .query(
      `INSERT INTO api_cache (path, body, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    )
    .run(path, body, Date.now());
}

export function cacheSummary(): { entries: number; newestAgeMs: number | null } {
  const row = db().query("SELECT COUNT(*) AS entries, MAX(fetched_at) AS newest FROM api_cache").get() as { entries: number; newest: number | null };
  return { entries: Number(row.entries), newestAgeMs: row.newest === null ? null : Math.max(0, Date.now() - Number(row.newest)) };
}
