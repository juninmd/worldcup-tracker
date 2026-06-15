import { config } from "./config.ts";
import type { WcEvent, TimelineItem, Player, LineupPlayer, EventStat } from "./types.ts";

const base = () => `https://www.thesportsdb.com/api/v1/json/${config.sportsdbKey}`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`);
  if (!res.ok) throw new Error(`SportsDB ${res.status} on ${path}`);
  return (await res.json()) as T;
}

/** All World Cup events of the configured season (full fixture + results). */
export async function seasonEvents(): Promise<WcEvent[]> {
  const d = await get<{ events: WcEvent[] | null }>(
    `/eventsseason.php?id=${config.leagueId}&s=${config.season}`,
  );
  return d.events ?? [];
}

export async function eventsOnDate(date: string): Promise<WcEvent[]> {
  const all = await seasonEvents();
  return all.filter((e) => e.dateEvent === date);
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
