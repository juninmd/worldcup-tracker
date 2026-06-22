import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Lives on the same PVC as state.json (/app/data in the cluster), so the cache
// survives pod restarts — the app can serve last-known data without hitting the
// rate-limited free API on every boot.
const FILE = new URL("../data/wc.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let _db: Database | null = null;
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
  d.exec(`CREATE TABLE IF NOT EXISTS api_cache (
    path       TEXT PRIMARY KEY,
    body       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );`);
  _db = d;
  return d;
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
