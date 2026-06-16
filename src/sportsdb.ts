import { config } from "./config.ts";
import { cacheGet, cachePut } from "./db.ts";
import type { WcEvent, TimelineItem, Player, LineupPlayer, EventStat, TableRow } from "./types.ts";

const base = () => `https://www.thesportsdb.com/api/v1/json/${config.sportsdbKey}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a cached body is considered fresh, by endpoint. Live feeds get a
 *  short TTL; near-static data (players, finished-season fixtures) much longer
 *  so we stop re-fetching it on every poll/restart. */
function ttlFor(path: string): number {
  if (path.startsWith("/searchplayers")) return 30 * 86_400_000; // players are static
  if (path.startsWith("/eventsseason") || path.startsWith("/lookuptable")) return 60_000;
  return 20_000; // eventsday/timeline/lookupevent/lineup/stats — live-ish
}

async function get<T>(path: string): Promise<T> {
  // L1: durable SQLite cache. Serve fresh hits without touching the API.
  const hit = cacheGet(path);
  if (hit && hit.age < ttlFor(path)) return JSON.parse(hit.body) as T;

  // Free key is rate-limited; back off on 429 so a transient throttle does not
  // crash the poll/homologation. Up to 3 retries with growing delay.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${base()}${path}`);
    } catch (err) {
      if (hit) return JSON.parse(hit.body) as T; // network down → last-known data
      throw err;
    }
    if (res.ok) {
      const text = await res.text();
      cachePut(path, text); // write-through so the next boot/poll can serve it
      return JSON.parse(text) as T;
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (hit) return JSON.parse(hit.body) as T; // API error → stale beats crashing
    throw new Error(`SportsDB ${res.status} on ${path}`);
  }
}

// Short-TTL cache for the heaviest, most-repeated feeds. Cuts redundant calls
// within a poll (well under the 60s interval) so we stay under the rate limit.
const TTL = 30_000;
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(k: string, f: () => Promise<T>): Promise<T> {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = await f();
  cache.set(k, { at: Date.now(), v });
  return v;
}

/** All World Cup events of the configured season (full fixture + results). */
export function seasonEvents(): Promise<WcEvent[]> {
  return cached("season", async () => {
    const d = await get<{ events: WcEvent[] | null }>(
      `/eventsseason.php?id=${config.leagueId}&s=${config.season}`,
    );
    return d.events ?? [];
  });
}

export async function eventsOnDate(date: string): Promise<WcEvent[]> {
  const all = await seasonEvents();
  return all.filter((e) => e.dateEvent === date);
}

/** Group-stage standings table (per-team points, GD, group). */
export function leagueTable(): Promise<TableRow[]> {
  return cached("table", async () => {
    const d = await get<{ table: TableRow[] | null }>(
      `/lookuptable.php?l=${config.leagueId}&s=${config.season}`,
    );
    return d.table ?? [];
  });
}

/** Events for a calendar day via the day feed — includes LIVE status (1H/HT/2H)
 *  for matches not yet present in the season feed. */
export async function eventsByDay(date: string): Promise<WcEvent[]> {
  const d = await get<{ events: WcEvent[] | null }>(
    `/eventsday.php?d=${date}&l=${config.leagueId}`,
  );
  return d.events ?? [];
}

/** Full event record (lookupevent) — richer than the season feed. */
export async function eventDetail(idEvent: string): Promise<WcEvent | null> {
  const d = await get<{ events: WcEvent[] | null }>(`/lookupevent.php?id=${idEvent}`);
  return d.events?.[0] ?? null;
}

export async function timeline(idEvent: string): Promise<TimelineItem[]> {
  const d = await get<{ timeline: TimelineItem[] | null }>(
    `/lookuptimeline.php?id=${idEvent}`,
  );
  return d.timeline ?? [];
}

export async function lineup(idEvent: string): Promise<LineupPlayer[]> {
  const d = await get<{ lineup: LineupPlayer[] | null }>(
    `/lookuplineup.php?id=${idEvent}`,
  );
  return d.lineup ?? [];
}

export async function eventStats(idEvent: string): Promise<EventStat[]> {
  const d = await get<{ eventstats: EventStat[] | null }>(
    `/lookupeventstats.php?id=${idEvent}`,
  );
  return d.eventstats ?? [];
}

const playerCache = new Map<string, Player | null>();

export async function findPlayer(name: string): Promise<Player | null> {
  if (playerCache.has(name)) return playerCache.get(name)!;
  let result: Player | null = null;
  try {
    const d = await get<{ player: Player[] | null }>(
      `/searchplayers.php?p=${encodeURIComponent(name)}`,
    );
    result = d.player?.[0] ?? null;
  } catch {
    result = null;
  }
  playerCache.set(name, result);
  return result;
}

/** A match is "in play" when it has started but is not finished/scheduled. */
export function isLive(e: WcEvent): boolean {
  const s = (e.strStatus ?? "").toUpperCase();
  return s !== "" && s !== "NS" && !["FT", "AET", "PEN", "MATCH FINISHED"].includes(s);
}

export function isFinished(e: WcEvent): boolean {
  const s = (e.strStatus ?? "").toUpperCase();
  return ["FT", "AET", "PEN", "MATCH FINISHED"].includes(s);
}
