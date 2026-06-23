import type { LineupPlayer, WcEvent } from "./types.ts";
import { isFinished, lineup } from "./sportsdb.ts";

// Position → match-impact weight; used to score absences of regular starters.
const POS_WEIGHT: [RegExp, number][] = [
  [/forward|striker|winger|attacker|st\b|cf\b|lw\b|rw\b|ss\b/i, 5],
  [/midfield|cam\b|am\b|cm\b|dm\b|lm\b|rm\b/i, 4],
  [/defend|back|cb\b|lb\b|rb\b|lwb\b|rwb\b/i, 3],
  [/goalkeeper|keeper|gk\b/i, 2],
];

function posWeight(pos: string | null): number {
  if (!pos) return 3;
  for (const [re, w] of POS_WEIGHT) if (re.test(pos)) return w;
  return 3;
}

function normalize(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export type StarterHistory = Map<
  string, // "TeamName|PlayerName"
  { starts: number; pos: string | null }
>;

let _cache: StarterHistory | null = null;
let _cacheTime = 0;
const CACHE_TTL = 15 * 60_000; // 15 min — refreshes once per polling window

/** Builds a map of every player who started a finished match this tournament.
 *  Relies on the SQLite lineup cache, so subsequent calls are near-instant. */
export async function buildStarterHistory(events: WcEvent[]): Promise<StarterHistory> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  const history: StarterHistory = new Map();
  for (const e of events.filter(isFinished)) {
    const xi = await lineup(e.idEvent).catch((): LineupPlayer[] => []);
    for (const p of xi) {
      if ((p.strSubstitute ?? "").toLowerCase() !== "no") continue;
      const team = (p.strHome ?? "").toLowerCase() === "yes" ? e.strHomeTeam : e.strAwayTeam;
      const key = `${team}|${p.strPlayer}`;
      const rec = history.get(key) ?? { starts: 0, pos: p.strPosition };
      history.set(key, { starts: rec.starts + 1, pos: rec.pos });
    }
  }

  _cache = history;
  _cacheTime = Date.now();
  return history;
}

/** Players who started enough past matches to be considered "regulars" but are
 *  absent from the confirmed lineup for this match.
 *  Returns [] when lineup is not yet confirmed (no starters found). */
export function missingKeyPlayers(
  xi: LineupPlayer[],
  team: string,
  isHome: boolean,
  history: StarterHistory,
): { name: string; weight: number }[] {
  // How many times this team's most-frequent starter appeared
  let maxStarts = 0;
  for (const [key, rec] of history) {
    const [t] = key.split("|") as [string];
    if (t === team && rec.starts > maxStarts) maxStarts = rec.starts;
  }
  if (!maxStarts) return [];

  // "Regular" = started in ≥50% of the team's max-start count (minimum 1)
  const threshold = Math.max(1, Math.floor(maxStarts * 0.5));

  const regulars = new Map<string, number>(); // playerName → weight
  for (const [key, rec] of history) {
    const [t, player] = key.split("|") as [string, string];
    if (t === team && rec.starts >= threshold) {
      regulars.set(player, posWeight(rec.pos));
    }
  }
  if (!regulars.size) return [];

  // Confirmed starters in today's lineup (normalized for accent-tolerant matching)
  const confirmed = xi
    .filter(p => (p.strHome ?? "").toLowerCase() === (isHome ? "yes" : "no") && (p.strSubstitute ?? "").toLowerCase() === "no")
    .map(p => normalize(p.strPlayer));
  if (!confirmed.length) return []; // lineup not published yet

  const missing: { name: string; weight: number }[] = [];
  for (const [player, weight] of regulars) {
    const norm = normalize(player);
    const surname = norm.split(" ").at(-1)!;
    const found = confirmed.some(c => c.includes(norm) || (surname.length > 3 && c.includes(surname)));
    if (!found) missing.push({ name: player, weight });
  }
  return missing;
}

/** Total quality penalty from absent regulars in the confirmed lineup. */
export function lineupPenalty(
  xi: LineupPlayer[],
  team: string,
  isHome: boolean,
  history: StarterHistory,
): number {
  return missingKeyPlayers(xi, team, isHome, history).reduce((sum, p) => sum + p.weight, 0);
}
