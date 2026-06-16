import { config } from "./config.ts";
import type { WcEvent, TimelineItem, Player, LineupPlayer, EventStat, TableRow } from "./types.ts";

const base = () => `https://www.thesportsdb.com/api/v1/json/${config.sportsdbKey}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(path: string): Promise<T> {
  // Free key is rate-limited; back off on 429 so a transient throttle does not
  // crash the poll/homologation. Up to 3 retries with growing delay.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base()}${path}`);
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
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
