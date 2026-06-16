import type { TimelineItem, WcEvent } from "./types.ts";

// Fallback goal source: api.sportdb.dev (Flashscore proxy). Used only when the
// primary TheSportsDB timeline is empty. Provides real scorer + assist + minute.
const BASE = "https://api.sportdb.dev";
const WC = "/api/flashscore/football/world:8/world-championship:lvUBR5F8";

const key = () => process.env.SPORTDB_KEY ?? "";

async function get<T>(path: string): Promise<T | null> {
  if (!key()) return null;
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { "X-API-Key": key() } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

interface FsMatch {
  eventId: string;
  homeName: string;
  awayName: string;
  startDateTimeUtc?: string;
  startUtime?: string;
}

/** Find the Flashscore match id for a TheSportsDB event by team names. Checks
 *  the live feed first (in-progress) then the season results (finished). */
async function findMatchId(e: WcEvent): Promise<string | null> {
  const h = norm(e.strHomeTeam), a = norm(e.strAwayTeam);
  const hit = (list: FsMatch[] | null) =>
    (list ?? []).find((m) => norm(m.homeName) === h && norm(m.awayName) === a)?.eventId ?? null;

  const live = hit(await get<FsMatch[]>(`${WC}/live`));
  if (live) return live;

  // results are paginated; scan a few recent pages
  for (let p = 1; p <= 3; p++) {
    const page = await get<FsMatch[]>(`${WC}/lvUBR5F8/2026/results?page=${p}`)
      ?? await get<FsMatch[]>(`${WC}/2026/results?page=${p}`);
    const id = hit(page);
    if (id) return id;
    if (!page || !page.length) break;
  }
  return null;
}

interface FsDetails {
  events: Array<{
    incidentTime: string;
    incidentSide: string; // "1" home | "2" away
    incidentType: string[];
    incidentTypeName: string[];
    incidentPlayerName: string[];
  }>;
}

/** Goal timeline for a TheSportsDB event via the Flashscore fallback, mapped to
 *  the same TimelineItem shape the engine already consumes. Empty if unavailable. */
export async function fallbackGoals(e: WcEvent): Promise<TimelineItem[]> {
  const id = await findMatchId(e);
  if (!id) return [];
  const d = await get<FsDetails>(`/api/flashscore/match/${id}/details`);
  if (!d?.events) return [];

  return d.events
    .filter((inc) => inc.incidentTypeName?.includes("Goal"))
    .map((inc) => {
      const home = inc.incidentSide === "1";
      const ai = inc.incidentTypeName.indexOf("Assistance");
      return {
        intTime: inc.incidentTime.replace(/\D/g, ""),
        strTimeline: "Goal",
        strTimelineDetail: null,
        strHome: home ? "yes" : "no",
        strPlayer: inc.incidentPlayerName?.[0] ?? null,
        strTeam: home ? e.strHomeTeam : e.strAwayTeam,
        idPlayer: null,
        strAssist: ai > 0 ? inc.incidentPlayerName?.[ai] ?? null : null,
        strComment: null,
      } satisfies TimelineItem;
    })
    .sort((x, y) => Number(x.intTime) - Number(y.intTime));
}
