import { cacheGet, cachePut, recordOperationalEvent } from "./db.ts";
import type { WcEvent, TimelineItem, Player, LineupPlayer, EventStat, TableRow, CardEvent, IntensityBucket } from "./types.ts";

const FIFA_BASE = "https://api.fifa.com/api/v3";
const FIFA_COMPETITION_ID = "17";
const FIFA_SEASON_ID = "285023";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ttlFor(path: string): number {
  if (path.startsWith("fifa:/calendar/matches")) return 20_000;
  if (path.startsWith("fifa:/timelines/")) return 15_000;
  if (path.startsWith("fifa:/teams/squads")) return 6 * 3_600_000;
  if (path.startsWith("fifa:/teams/")) return 24 * 3_600_000; // team profile (confederation, city…) never changes mid-tournament
  if (path.startsWith("fifa:/seasons/")) return 24 * 3_600_000;
  if (path.startsWith("fifa:/players/")) return 3_600_000; // caps/goals only change after a player's next cap
  return 20_000;
}

async function getJson<T>(cachePath: string, url: string): Promise<T> {
  const started = Date.now();
  const observe = (outcome: "ok" | "cache" | "stale" | "error") =>
    recordOperationalEvent({ subsystem: "fifa", operation: cachePath, outcome, latencyMs: Date.now() - started });
  const hit = cacheGet(cachePath);
  if (hit && hit.age < ttlFor(cachePath)) {
    observe("cache");
    return JSON.parse(hit.body) as T;
  }

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "worldcup-tracker/1.0" } });
    } catch (err) {
      if (hit) { observe("stale"); return JSON.parse(hit.body) as T; }
      observe("error");
      throw err;
    }
    if (res.ok) {
      const text = await res.text();
      cachePut(cachePath, text);
      observe("ok");
      return JSON.parse(text) as T;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (hit) { observe("stale"); return JSON.parse(hit.body) as T; }
    observe("error");
    throw new Error(`FIFA ${res.status} on ${url}`);
  }
}

const TTL = 15_000;
const memoryCache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(k: string, f: () => Promise<T>): Promise<T> {
  const hit = memoryCache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = await f();
  memoryCache.set(k, { at: Date.now(), v });
  return v;
}

type Localized = { Locale: string; Description: string };
type FifaTeam = {
  Score: number | null;
  IdTeam: string;
  IdCountry: string;
  TeamName: Localized[];
  ShortClubName?: string | null;
  PictureUrl?: string | null;
};
type FifaMatch = {
  IdMatch: string;
  IdCompetition: string;
  IdSeason: string;
  IdStage?: string | null;
  IdGroup?: string | null;
  Date: string;
  LocalDate?: string | null;
  Home: FifaTeam | null;
  Away: FifaTeam | null;
  HomeTeamScore: number | null;
  AwayTeamScore: number | null;
  HomeTeamPenaltyScore?: number | null;
  AwayTeamPenaltyScore?: number | null;
  Winner?: string | null;
  MatchStatus: number;
  MatchTime?: string | null;
  MatchNumber?: number | null;
  PlaceHolderA?: string | null;
  PlaceHolderB?: string | null;
  Stadium?: {
    Name?: Localized[];
    CityName?: Localized[];
    IdCountry?: string | null;
  } | null;
  GroupName?: Localized[];
  StageName?: Localized[];
  Attendance?: string | null;
};
type FifaMatchesResponse = { Results: FifaMatch[] };

type FifaTimelineEvent = {
  EventId: string;
  IdTeam?: string;
  IdPlayer?: string;
  MatchMinute?: string | null;
  Type?: number | null;
  PositionX?: number | null;
  PositionY?: number | null;
  TypeLocalized?: Localized[];
  EventDescription?: Localized[];
};
type FifaTimelineResponse = { Event: FifaTimelineEvent[] };
type FifaPlayer = {
  IdTeam: string;
  IdPlayer: string;
  PlayerName: Localized[];
  ShortName?: Localized[];
  JerseyNum?: number | null;
  BirthDate?: string | null;
  Height?: number | null;
  Weight?: number | null;
  IdCountry?: string | null;
  PositionLocalized?: Localized[];
  PlayerPicture?: { PictureUrl?: string | null } | null;
};
type FifaSquad = {
  IdTeam: string;
  IdCountry: string;
  TeamName: Localized[];
  Players: FifaPlayer[];
};
type FifaSquadsResponse = { Results: FifaSquad[] };
type JsonRecord = Record<string, unknown>;

export interface FifaEndpointHealth {
  name: string;
  path: string;
  ok: boolean;
  count: number;
}

function text(value?: Localized[] | null): string {
  return value?.find((v) => v.Locale.toLowerCase() === "en-gb")?.Description ?? value?.[0]?.Description ?? "";
}

function flagUrl(url?: string | null): string | null {
  return url?.replace("{format}", "png").replace("{size}", "4") ?? null;
}

function statusOf(match: FifaMatch): string {
  if (match.MatchStatus === 0) return "FT";
  if (match.MatchStatus === 1) return "NS";
  if (match.MatchStatus === 3) return "1H";
  return "NS";
}

export function mapFifaMatch(match: FifaMatch): WcEvent {
  const home = match.Home ? match.Home.ShortClubName || text(match.Home.TeamName) : match.PlaceHolderA || "TBD";
  const away = match.Away ? match.Away.ShortClubName || text(match.Away.TeamName) : match.PlaceHolderB || "TBD";
  return {
    idEvent: match.IdMatch,
    strEvent: `${home} vs ${away}`,
    dateEvent: match.Date.slice(0, 10),
    strTimestamp: match.Date,
    strStatus: statusOf(match),
    strProgress: match.MatchTime?.replace("'", "") || null,
    strHomeTeam: home,
    strAwayTeam: away,
    idHomeTeam: match.Home?.IdTeam ?? match.PlaceHolderA ?? "",
    idAwayTeam: match.Away?.IdTeam ?? match.PlaceHolderB ?? "",
    idWinnerTeam: match.Winner ?? null,
    intHomeScore: match.HomeTeamScore === null || match.HomeTeamScore === undefined ? null : String(match.HomeTeamScore),
    intAwayScore: match.AwayTeamScore === null || match.AwayTeamScore === undefined ? null : String(match.AwayTeamScore),
    intHomePenaltyScore: match.HomeTeamPenaltyScore === null || match.HomeTeamPenaltyScore === undefined ? null : String(match.HomeTeamPenaltyScore),
    intAwayPenaltyScore: match.AwayTeamPenaltyScore === null || match.AwayTeamPenaltyScore === undefined ? null : String(match.AwayTeamPenaltyScore),
    strVenue: text(match.Stadium?.Name),
    strLeague: "FIFA World Cup",
    idCompetition: match.IdCompetition ?? null,
    strStage: text(match.StageName) || null,
    strPlaceHolderA: match.PlaceHolderA ?? null,
    strPlaceHolderB: match.PlaceHolderB ?? null,
    strCity: text(match.Stadium?.CityName),
    strCountry: match.Stadium?.IdCountry ?? null,
    strGroup: text(match.GroupName) || null,
    intRound: match.MatchNumber ? String(match.MatchNumber) : null,
    intSpectators: match.Attendance ?? null,
    strTimeLocal: match.LocalDate ?? null,
    strHomeTeamBadge: flagUrl(match.Home?.PictureUrl),
    strAwayTeamBadge: flagUrl(match.Away?.PictureUrl),
    strPoster: null,
    strThumb: null,
    strFanart: null,
    strBanner: null,
    strVideo: null,
  };
}

function fifaMatches(): Promise<FifaMatch[]> {
  return cached("fifa-season", async () => {
    const path = `/calendar/matches?idSeason=${FIFA_SEASON_ID}&idCompetition=${FIFA_COMPETITION_ID}&count=120`;
    const d = await getJson<FifaMatchesResponse>(`fifa:${path}`, `${FIFA_BASE}${path}`);
    return d.Results ?? [];
  });
}

/** Official FIFA World Cup 2026 fixtures, scores and live statuses. */
export async function seasonEvents(): Promise<WcEvent[]> {
  return (await fifaMatches()).map(mapFifaMatch);
}

export const BRAZIL_ID_TEAM = "43924";

/** Brazil's non-World-Cup fixtures (friendlies, qualifiers) from the official FIFA
 *  calendar within a date window — so the bot keeps following the Seleção after the
 *  Cup. World Cup matches (competition 17) are excluded; that's what the tracker
 *  already covers. `from`/`to` are ISO instants (…Z). */
export async function brazilFixtures(fromIso: string, toIso: string): Promise<WcEvent[]> {
  // FIFA's calendar silently ignores the window (and dumps historical matches) if the
  // instant carries milliseconds. Use plain YYYY-MM-DD — colon-free, so fetch's URL
  // normalisation can't mangle it either.
  const day = (iso: string) => iso.slice(0, 10);
  const path = `/calendar/matches?idTeam=${BRAZIL_ID_TEAM}&from=${day(fromIso)}&to=${day(toIso)}&count=30`;
  const d = await getJson<FifaMatchesResponse | null>(`fifa:${path}`, `${FIFA_BASE}${path}`).catch(() => null);
  return (d?.Results ?? [])
    .filter((m) => m.IdCompetition !== FIFA_COMPETITION_ID)
    .map(mapFifaMatch)
    .sort((a, b) => (a.strTimestamp ?? a.dateEvent).localeCompare(b.strTimestamp ?? b.dateEvent));
}

/** Every match of a competition inside a date window. The window alone identifies the
 *  cycle — no idSeason needed — so this keeps working when FIFA publishes the 2030
 *  qualifiers under a new season id. Returns [] while a cycle is unpublished: the feed
 *  answers a bare `null` body for empty windows, which getJson surfaces as null. */
export async function competitionFixtures(idCompetition: string, fromIso: string, toIso: string): Promise<WcEvent[]> {
  const day = (iso: string) => iso.slice(0, 10);
  const path = `/calendar/matches?idCompetition=${idCompetition}&from=${day(fromIso)}&to=${day(toIso)}&count=200`;
  const d = await getJson<FifaMatchesResponse | null>(`fifa:${path}`, `${FIFA_BASE}${path}`).catch(() => null);
  return (d?.Results ?? [])
    .map(mapFifaMatch)
    .sort((a, b) => (a.strTimestamp ?? a.dateEvent).localeCompare(b.strTimestamp ?? b.dateEvent));
}

export async function eventsOnDate(date: string): Promise<WcEvent[]> {
  return (await seasonEvents()).filter((e) => e.dateEvent === date);
}

export async function eventsByDay(date: string): Promise<WcEvent[]> {
  return eventsOnDate(date);
}

export async function mergedSeasonEvents(): Promise<WcEvent[]> {
  return seasonEvents();
}

/** Standings are derived locally from official FIFA match results. */
export async function leagueTable(): Promise<TableRow[]> {
  const finished = (await seasonEvents()).filter(isFinished).filter((e) => e.strGroup);
  const byGroup = new Map<string, Map<string, TableRow>>();
  const row = (group: string, team: string) => {
    const rows = byGroup.get(group) ?? byGroup.set(group, new Map()).get(group)!;
    const hit = rows.get(team);
    if (hit) return hit;
    const next: TableRow = {
      intRank: null,
      strTeam: team,
      strGroup: group,
      intPlayed: "0",
      intWin: "0",
      intDraw: "0",
      intLoss: "0",
      intGoalsFor: "0",
      intGoalsAgainst: "0",
      intGoalDifference: "0",
      intPoints: "0",
    };
    rows.set(team, next);
    return next;
  };
  const add = (r: TableRow, gf: number, ga: number) => {
    const w = gf > ga ? 1 : 0;
    const d = gf === ga ? 1 : 0;
    const l = gf < ga ? 1 : 0;
    r.intPlayed = String(Number(r.intPlayed) + 1);
    r.intWin = String(Number(r.intWin) + w);
    r.intDraw = String(Number(r.intDraw) + d);
    r.intLoss = String(Number(r.intLoss) + l);
    r.intGoalsFor = String(Number(r.intGoalsFor) + gf);
    r.intGoalsAgainst = String(Number(r.intGoalsAgainst) + ga);
    r.intGoalDifference = String(Number(r.intGoalsFor) - Number(r.intGoalsAgainst));
    r.intPoints = String(Number(r.intPoints) + w * 3 + d);
  };

  for (const e of finished) {
    const group = e.strGroup!;
    const home = row(group, e.strHomeTeam);
    const away = row(group, e.strAwayTeam);
    const hs = Number(e.intHomeScore) || 0;
    const as = Number(e.intAwayScore) || 0;
    add(home, hs, as);
    add(away, as, hs);
  }

  return [...byGroup.values()].flatMap((rows) =>
    [...rows.values()]
      .sort((a, b) =>
        Number(b.intPoints) - Number(a.intPoints) ||
        Number(b.intGoalDifference) - Number(a.intGoalDifference) ||
        Number(b.intGoalsFor) - Number(a.intGoalsFor) ||
        a.strTeam.localeCompare(b.strTeam),
      )
      .map((r, i) => ({ ...r, intRank: String(i + 1) })),
  );
}

export async function eventDetail(idEvent: string): Promise<WcEvent | null> {
  return (await seasonEvents()).find((e) => e.idEvent === idEvent) ?? null;
}

function playerFromDescription(description: string): string | null {
  const match = description.match(/^(.+?)\s+\(/);
  if (!match) return null;
  const raw = match[1]?.trim();
  if (!raw || raw === "Goal") return null;
  return raw.replace(/\b([A-Z]{2,})\b/g, (m) => m[0] + m.slice(1).toLowerCase());
}

function assistFromDescription(description: string): string | null {
  const match = description.match(/Assisted by\s+(.+?)\.?$/i);
  if (!match) return null;
  const raw = match[1]?.trim();
  return raw ? raw.replace(/\b([A-Z]{2,})\b/g, (m) => m[0] + m.slice(1).toLowerCase()) : null;
}

export function mapFifaTimelineEvent(item: FifaTimelineEvent, e: WcEvent, allItems?: FifaTimelineEvent[]): TimelineItem | null {
  const kind = text(item.TypeLocalized);
  if (![0, 34, 41].includes(item.Type ?? -1) && !/^(own goal|penalty goal|goal!?)$/i.test(kind)) return null;
  const description = text(item.EventDescription);
  const eventTeam = item.IdTeam === e.idHomeTeam ? e.strHomeTeam : item.IdTeam === e.idAwayTeam ? e.strAwayTeam : null;
  const team = /own goal/i.test(kind)
    ? eventTeam === e.strHomeTeam ? e.strAwayTeam : eventTeam === e.strAwayTeam ? e.strHomeTeam : null
    : eventTeam;
  // The official timeline emits the assist as its own event (Type 1) at the
  // same minute/team as the goal it set up.
  const assistEvent = allItems?.find((a) =>
    (a.Type ?? -1) === 1 && a.IdTeam === item.IdTeam && a.MatchMinute === item.MatchMinute,
  );
  return {
    idTimeline: item.EventId,
    intTime: item.MatchMinute?.replace("'", "") ?? "",
    strTimeline: "Goal",
    strTimelineDetail: kind,
    strHome: team === e.strHomeTeam ? "yes" : "no",
    strPlayer: team ? playerFromDescription(description) : null,
    strTeam: team,
    idPlayer: item.IdPlayer ?? null,
    strAssist: assistEvent ? assistFromDescription(text(assistEvent.EventDescription)) : null,
    strComment: description || null,
  };
}

export function mapFifaCardEvent(item: FifaTimelineEvent, e: WcEvent): CardEvent | null {
  const kind = text(item.TypeLocalized);
  const cardType = /red card/i.test(kind) ? "red" : /yellow card/i.test(kind) ? "yellow" : null;
  if (!cardType) return null;
  const description = text(item.EventDescription);
  const team = item.IdTeam === e.idHomeTeam ? e.strHomeTeam : item.IdTeam === e.idAwayTeam ? e.strAwayTeam : null;
  return {
    idTimeline: item.EventId,
    intTime: item.MatchMinute?.replace("'", "") ?? "",
    strPlayer: playerFromDescription(description),
    strTeam: team,
    strHome: team === e.strHomeTeam ? "yes" : team === e.strAwayTeam ? "no" : null,
    cardType,
  };
}

/** Cartões (amarelo/vermelho) da partida, com jogador e minuto — derivado da timeline oficial FIFA. */
export async function cardEvents(idEvent: string): Promise<CardEvent[]> {
  const event = await eventDetail(idEvent);
  if (!event) return [];
  return (await fifaTimeline(idEvent)).map((item) => mapFifaCardEvent(item, event)).filter((x): x is CardEvent => !!x);
}

const INTENSITY_PERIODS: readonly (readonly [number, number])[] = [
  [0, 15], [16, 30], [31, 45], [46, 60], [61, 75], [76, 999],
];
const INTENSITY_KIND = /Attempt at Goal|^Corner$|^Foul$|Yellow card|Red card|^(own goal|penalty goal|goal!?)$/i;

/** Buckets timestamped match events (shots, corners, fouls, cards, goals) into
 *  15-minute periods per side — a temporal "heat" of match intensity derived from
 *  real, timestamped FIFA events (not pitch-position tracking, which the free feed lacks). */
export function intensityBuckets(items: FifaTimelineEvent[], e: WcEvent): IntensityBucket[] {
  return INTENSITY_PERIODS.map(([lo, hi]) => {
    const label = hi === 999 ? `${lo}+` : `${lo}-${hi}`;
    const inRange = items.filter((item) => {
      if (!INTENSITY_KIND.test(text(item.TypeLocalized))) return false;
      const minute = Number(item.MatchMinute?.replace("'", ""));
      return !Number.isNaN(minute) && minute >= lo && minute <= hi;
    });
    return {
      label,
      home: inRange.filter((item) => item.IdTeam === e.idHomeTeam).length,
      away: inRange.filter((item) => item.IdTeam === e.idAwayTeam).length,
    };
  });
}

export async function matchIntensity(idEvent: string): Promise<IntensityBucket[]> {
  const event = await eventDetail(idEvent);
  if (!event) return [];
  return intensityBuckets(await fifaTimeline(idEvent), event);
}

async function fifaTimeline(idEvent: string): Promise<FifaTimelineEvent[]> {
  const d = await getJson<FifaTimelineResponse>(
    `fifa:/timelines/${idEvent}`,
    `${FIFA_BASE}/timelines/${idEvent}`,
  );
  return d.Event ?? [];
}

export interface SubstitutionItem {
  minute: string;
  team: string | null;
  playerIn: string | null;
  playerOut: string | null;
}

/** Substitutions for a single match, from the official FIFA timeline (Type 5). */
export async function substitutionEvents(idEvent: string): Promise<SubstitutionItem[]> {
  const event = await eventDetail(idEvent);
  if (!event) return [];
  const items = await fifaTimeline(idEvent);
  const out: SubstitutionItem[] = [];
  for (const item of items) {
    if ((item.Type ?? -1) !== 5) continue;
    const description = text(item.EventDescription);
    const match = description.match(/^(.+?)\s+\(in\)\s+comes off the bench to replace\s+(.+?)\s+\(out\)/i);
    if (!match) continue;
    const cap = (s: string) => s.replace(/\b([A-Z]{2,})\b/g, (m) => m[0] + m.slice(1).toLowerCase());
    const team = item.IdTeam === event.idHomeTeam ? event.strHomeTeam : item.IdTeam === event.idAwayTeam ? event.strAwayTeam : null;
    out.push({
      minute: item.MatchMinute?.replace("'", "") ?? "",
      team,
      playerIn: cap(match[1]!.trim()),
      playerOut: cap(match[2]!.trim()),
    });
  }
  return out;
}

export interface VarIncident {
  minute: string;
  team: string | null;
  comment: string | null;
  /** What the review resolved into (e.g. "Cartão vermelho — Breel Embolo"), resolved
   *  from the nearest card/goal event in the timeline — FIFA's VAR entry (Type 71)
   *  often omits IdTeam and never states the outcome itself. */
  outcome: string | null;
}

export interface MatchIncident {
  minute: string;
  team: string | null;
  kind: "penalty";
  player: string | null;
  detail: string;
}

export interface ShotEvent {
  minute: string;
  team: string | null;
  player: string | null;
  x: number | null;
  y: number | null;
  outcome: "goal" | "saved" | "attempt";
  zone: "penalty" | "small_area" | "box" | "outside_box" | "unknown";
  xg: number;
  clearChance: boolean;
  detail: string;
}

/** VAR review incidents for a single match, from the official FIFA timeline (Type 71). */
const VAR_RESOLVED_KIND = /red card|yellow card|^(own goal|penalty goal|goal!?)$/i;

export async function varIncidents(idEvent: string): Promise<VarIncident[]> {
  const event = await eventDetail(idEvent);
  if (!event) return [];
  const items = await fifaTimeline(idEvent);
  return items
    .filter((item) => (item.Type ?? -1) === 71)
    .map((item) => {
      const minute = Number(item.MatchMinute?.replace("'", ""));
      // The review's minute rarely lines up exactly with the card/goal it produced
      // (a few minutes of on-pitch review time) — take the closest resolved event.
      let related: FifaTimelineEvent | null = null;
      let bestDist = Infinity;
      for (const cand of items) {
        if (cand === item || !VAR_RESOLVED_KIND.test(text(cand.TypeLocalized))) continue;
        const candMinute = Number(cand.MatchMinute?.replace("'", ""));
        const dist = Math.abs(candMinute - minute);
        if (!Number.isNaN(dist) && dist <= 3 && dist < bestDist) { bestDist = dist; related = cand; }
      }
      const teamId = item.IdTeam ?? related?.IdTeam;
      const team = teamId === event.idHomeTeam ? event.strHomeTeam : teamId === event.idAwayTeam ? event.strAwayTeam : null;
      const outcome = related
        ? `${text(related.TypeLocalized)}${playerFromDescription(text(related.EventDescription)) ? ` — ${playerFromDescription(text(related.EventDescription))}` : ""}`
        : null;
      return {
        minute: item.MatchMinute?.replace("'", "") ?? "",
        team,
        comment: text(item.EventDescription) || null,
        outcome,
      };
    });
}

/** Important non-goal incidents that FIFA exposes as multiple low-level timeline
 *  events. Example: a missed/saved penalty is Penalty Awarded + Attempt at Goal
 *  + Goal Prevention at the same minute. */
export async function matchIncidents(idEvent: string): Promise<MatchIncident[]> {
  const event = await eventDetail(idEvent);
  if (!event) return [];
  const items = await fifaTimeline(idEvent);
  return items
    .filter((item) => (item.Type ?? -1) === 6 || /^Penalty Awarded$/i.test(text(item.TypeLocalized)))
    .map((item) => {
      const minute = item.MatchMinute?.replace("'", "") ?? "";
      const team = item.IdTeam === event.idHomeTeam ? event.strHomeTeam : item.IdTeam === event.idAwayTeam ? event.strAwayTeam : null;
      const attempt = items.find((x) =>
        (x.Type ?? -1) === 12
        && x.IdTeam === item.IdTeam
        && x.MatchMinute === item.MatchMinute
        && /attempts an effort on goal/i.test(text(x.EventDescription)));
      const save = items.find((x) =>
        (x.Type ?? -1) === 57
        && x.IdTeam !== item.IdTeam
        && x.MatchMinute === item.MatchMinute);
      const player = attempt ? playerFromDescription(text(attempt.EventDescription)) : null;
      return {
        minute,
        team,
        kind: "penalty" as const,
        player,
        detail: save
          ? `Pênalti cobrado por ${player ?? "jogador não identificado"} e defendido pelo goleiro adversário.`
          : `Pênalti concedido${player ? `; cobrança de ${player}` : ""}.`,
      };
    });
}

function shotZone(item: FifaTimelineEvent, event: WcEvent, penalty: boolean): ShotEvent["zone"] {
  if (penalty) return "penalty";
  if (item.PositionX === undefined || item.PositionX === null || item.PositionY === undefined || item.PositionY === null) return "unknown";
  const targetX = item.IdTeam === event.idHomeTeam ? 100 : 0;
  const distanceToLine = Math.abs(targetX - item.PositionX);
  const centrality = Math.abs(50 - item.PositionY);
  if (distanceToLine <= 6 && centrality <= 18) return "small_area";
  if (distanceToLine <= 17 && centrality <= 28) return "box";
  return "outside_box";
}

function shotXg(zone: ShotEvent["zone"], outcome: ShotEvent["outcome"]): number {
  const base = zone === "penalty" ? 0.76
    : zone === "small_area" ? 0.38
    : zone === "box" ? 0.16
    : zone === "outside_box" ? 0.04
    : 0.06;
  const adjusted = outcome === "saved" && zone !== "penalty" ? base + 0.04 : base;
  return Math.round(adjusted * 100) / 100;
}

function hasPenaltyAt(items: FifaTimelineEvent[], item: FifaTimelineEvent): boolean {
  return items.some((x) =>
    (x.Type ?? -1) === 6
    && x.IdTeam === item.IdTeam
    && x.MatchMinute === item.MatchMinute);
}

function shotOutcome(items: FifaTimelineEvent[], item: FifaTimelineEvent): ShotEvent["outcome"] {
  const goal = items.some((x) =>
    [0, 34, 41].includes(x.Type ?? -1)
    && x.IdTeam === item.IdTeam
    && x.MatchMinute === item.MatchMinute
    && (x.IdPlayer === item.IdPlayer || playerFromDescription(text(x.EventDescription)) === playerFromDescription(text(item.EventDescription))));
  if (goal) return "goal";
  const save = items.some((x) =>
    (x.Type ?? -1) === 57
    && x.IdTeam !== item.IdTeam
    && x.MatchMinute === item.MatchMinute);
  return save ? "saved" : "attempt";
}

/** Attempts on goal with coarse location-derived xG. FIFA's free feed has shot
 *  coordinates, but no defender tracking; "clearChance" is therefore inferred. */
export async function shotEvents(idEvent: string): Promise<ShotEvent[]> {
  const event = await eventDetail(idEvent);
  if (!event) return [];
  const items = await fifaTimeline(idEvent);
  return items
    .filter((item) => (item.Type ?? -1) === 12)
    .map((item) => {
      const penalty = hasPenaltyAt(items, item);
      const outcome = shotOutcome(items, item);
      const zone = shotZone(item, event, penalty);
      const xg = shotXg(zone, outcome);
      const player = playerFromDescription(text(item.EventDescription));
      const team = item.IdTeam === event.idHomeTeam ? event.strHomeTeam : item.IdTeam === event.idAwayTeam ? event.strAwayTeam : null;
      const clearChance = penalty || zone === "small_area" || (zone === "box" && outcome === "saved");
      return {
        minute: item.MatchMinute?.replace("'", "") ?? "",
        team,
        player,
        x: item.PositionX ?? null,
        y: item.PositionY ?? null,
        outcome,
        zone,
        xg,
        clearChance,
        detail: `${player ?? "Jogador não identificado"} (${team ?? "?"}) finalizou ${zone === "penalty" ? "de pênalti" : zone === "small_area" ? "na pequena área" : zone === "box" ? "dentro da área" : "de fora/posição distante"}; resultado: ${outcome === "goal" ? "gol" : outcome === "saved" ? "defesa do goleiro" : "sem gol"}.`,
      };
    });
}

export async function fifaEndpointHealth(): Promise<FifaEndpointHealth[]> {
  const events = await seasonEvents();
  const squads = await fifaSquads();
  const finished = events.find(isFinished);
  const live = events.find(isLive);
  const timelineEvents = finished ? await fifaTimeline(finished.idEvent).catch(() => []) : [];
  const livePayload = live ? await fifaLiveMatch(live.idEvent).catch(() => null) : null;
  return [
    {
      name: "calendar",
      path: `/calendar/matches?idSeason=${FIFA_SEASON_ID}&idCompetition=${FIFA_COMPETITION_ID}&count=120`,
      ok: events.length === 104,
      count: events.length,
    },
    {
      name: "squads",
      path: `/teams/squads/all/${FIFA_COMPETITION_ID}/${FIFA_SEASON_ID}`,
      ok: squads.length === 48 && squads.every((s) => s.Players.length >= 23),
      count: squads.reduce((sum, squad) => sum + squad.Players.length, 0),
    },
    {
      name: "timeline",
      path: finished ? `/timelines/${finished.idEvent}` : "/timelines/{IdMatch}",
      ok: timelineEvents.length > 0,
      count: timelineEvents.length,
    },
    {
      name: "live",
      path: live ? `/live/football/${live.idEvent}` : "/live/football/{IdMatch}",
      ok: live ? !!livePayload : true,
      count: livePayload ? 1 : 0,
    },
  ];
}

async function fifaLiveMatch(idEvent: string): Promise<unknown | null> {
  const urls = [
    `${FIFA_BASE}/live/football/${idEvent}`,
    `${FIFA_BASE}/live/football/${FIFA_COMPETITION_ID}/${FIFA_SEASON_ID}/en/${idEvent}`,
    `${FIFA_BASE}/live/football/${FIFA_COMPETITION_ID}/${FIFA_SEASON_ID}/${idEvent}/en`,
  ];
  for (const url of urls) {
    const body = await getJson<unknown>(`fifa:${new URL(url).pathname}`, url).catch(() => null);
    if (body) return body;
  }
  return null;
}

export function mapFifaPlayer(player: FifaPlayer, teamName: string): Player {
  const height = player.Height ? `Altura: ${player.Height}cm` : "";
  const weight = player.Weight ? `Peso: ${player.Weight}kg` : "";
  const born = player.BirthDate ? `Nascimento: ${player.BirthDate.slice(0, 10)}` : "";
  return {
    strPlayer: playerFromDescription(`${text(player.PlayerName)} (`) ?? text(player.PlayerName),
    strTeam: teamName,
    strPosition: text(player.PositionLocalized) || null,
    strNumber: player.JerseyNum ? String(player.JerseyNum) : null,
    strNationality: player.IdCountry ?? null,
    dateBorn: player.BirthDate?.slice(0, 10) ?? null,
    strThumb: player.PlayerPicture?.PictureUrl ?? null,
    strCutout: player.PlayerPicture?.PictureUrl ?? null,
    strDescriptionEN: [height, weight, born].filter(Boolean).join(" · ") || null,
  };
}

/** Every registered player across all 48 squads, mapped to the public Player shape. */
export async function allSquadPlayers(): Promise<Player[]> {
  const squads = await fifaSquads();
  return squads.flatMap((squad) => squad.Players.map((p) => mapFifaPlayer(p, text(squad.TeamName))));
}

type FifaTeamProfile = {
  IdTeam: string;
  IdConfederation: string | null;
  City: string | null;
  FoundationYear: number | null;
};

const CONFEDERATION_NAMES: Record<string, string> = {
  UEFA: "UEFA (Europa)",
  CONMEBOL: "CONMEBOL (América do Sul)",
  CONCACAF: "CONCACAF (América do Norte/Central)",
  CAF: "CAF (África)",
  AFC: "AFC (Ásia)",
  OFC: "OFC (Oceania)",
};

async function fifaTeamProfile(idTeam: string): Promise<FifaTeamProfile | null> {
  return getJson<FifaTeamProfile>(`fifa:/teams/${idTeam}`, `${FIFA_BASE}/teams/${idTeam}`).catch(() => null);
}

export interface TeamConfederation {
  idTeam: string;
  confederation: string | null;
  confederationName: string;
}

/** Confederation (UEFA, CONMEBOL, AFC…) for a team, from its official FIFA profile. */
export async function teamConfederation(idTeam: string): Promise<TeamConfederation> {
  const profile = await fifaTeamProfile(idTeam);
  const confederation = profile?.IdConfederation ?? null;
  return { idTeam, confederation, confederationName: confederation ? CONFEDERATION_NAMES[confederation] ?? confederation : "Desconhecida" };
}

export interface TournamentInfo {
  name: string;
  startDate: string | null;
  endDate: string | null;
  mascotUrl: string | null;
  matchBallUrl: string | null;
  posterUrl: string | null;
}

type FifaSeasonInfo = {
  Name?: Localized[];
  StartDate?: string | null;
  EndDate?: string | null;
  PictureUrl?: string | null;
  MascotPictureUrl?: string | null;
  MatchBallPictureUrl?: string | null;
};

/** Official tournament metadata (dates, mascot, match ball artwork) from the FIFA season profile. */
export async function tournamentInfo(): Promise<TournamentInfo> {
  const path = `/seasons/${FIFA_SEASON_ID}`;
  const d = await getJson<FifaSeasonInfo>(`fifa:${path}`, `${FIFA_BASE}${path}`).catch(() => ({} as FifaSeasonInfo));
  return {
    name: text(d.Name) || "FIFA World Cup 2026™",
    startDate: d.StartDate ?? null,
    endDate: d.EndDate ?? null,
    mascotUrl: flagUrl(d.MascotPictureUrl),
    matchBallUrl: flagUrl(d.MatchBallPictureUrl),
    posterUrl: flagUrl(d.PictureUrl),
  };
}

async function fifaSquads(): Promise<FifaSquad[]> {
  return cached("fifa-squads", async () => {
    const path = `/teams/squads/all/${FIFA_COMPETITION_ID}/${FIFA_SEASON_ID}`;
    const d = await getJson<FifaSquadsResponse>(`fifa:${path}`, `${FIFA_BASE}${path}`);
    return d.Results ?? [];
  });
}

export async function squadPlayers(teamId: string): Promise<LineupPlayer[]> {
  const squad = (await fifaSquads()).find((s) => s.IdTeam === teamId);
  if (!squad) return [];
  return squad.Players
    .slice()
    .sort((a, b) => (a.JerseyNum ?? 999) - (b.JerseyNum ?? 999))
    .map((p) => ({
      strPlayer: mapFifaPlayer(p, text(squad.TeamName)).strPlayer,
      strPosition: text(p.PositionLocalized) || null,
      strSubstitute: "Yes",
      strHome: null,
      intSquadNumber: p.JerseyNum ? String(p.JerseyNum) : null,
      idPlayer: p.IdPlayer,
      strThumb: p.PlayerPicture?.PictureUrl ?? null,
    }));
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function localizedUnknown(value: unknown): string | null {
  if (Array.isArray(value)) return text(value as Localized[]) || null;
  return asString(value);
}

function playerNameFromAny(row: JsonRecord): string | null {
  return localizedUnknown(row.PlayerName)
    ?? localizedUnknown(row.Name)
    ?? localizedUnknown(row.ShortName)
    ?? localizedUnknown(row.DisplayName)
    ?? localizedUnknown(row.FullName);
}

function playerPhotoFromAny(row: JsonRecord): string | null {
  const direct = asString(row.PictureUrl) ?? asString(row.ImageUrl) ?? asString(row.PhotoUrl);
  if (direct) return direct;
  const pic = asRecord(row.PlayerPicture) ?? asRecord(row.Picture) ?? asRecord(row.Image);
  return pic ? asString(pic.PictureUrl) ?? asString(pic.Url) ?? asString(pic.URL) : null;
}

function lineupStatus(row: JsonRecord): "No" | "Yes" | null {
  if (row.Status === 1) return "No";
  if (row.Status === 2) return "Yes";
  const values = [row.Status, row.LineupStatus, row.Type, row.PositionType, row.IsStarter, row.Starting]
    .map((v) => typeof v === "boolean" ? String(v) : asString(v)?.toLowerCase())
    .filter((v): v is string => !!v);
  if (values.some((v) => /starter|starting|first xi|lineup|^true$|^1$/.test(v))) return "No";
  if (values.some((v) => /sub|bench|reserve|^false$/.test(v))) return "Yes";
  return null;
}

function mapLineupRow(row: JsonRecord, home: boolean): LineupPlayer | null {
  const player = asRecord(row.Player) ?? asRecord(row.Person) ?? row;
  const name = playerNameFromAny(player);
  if (!name) return null;
  return {
    strPlayer: playerFromDescription(`${name} (`) ?? name,
    strPosition: localizedUnknown(row.PositionLocalized) ?? localizedUnknown(row.Position) ?? localizedUnknown(player.PositionLocalized) ?? null,
    strSubstitute: lineupStatus(row) ?? lineupStatus(player),
    strHome: home ? "Yes" : "No",
    intSquadNumber: asString(row.JerseyNum) ?? asString(row.ShirtNumber) ?? asString(row.Number) ?? asString(player.JerseyNum),
    idPlayer: asString(row.IdPlayer) ?? asString(player.IdPlayer),
    strThumb: playerPhotoFromAny(player),
  };
}

function collectLineupRows(value: unknown, home: boolean): LineupPlayer[] {
  const out: LineupPlayer[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      const mapped = node.map((x) => asRecord(x)).filter((x): x is JsonRecord => !!x).map((x) => mapLineupRow(x, home));
      const players = mapped.filter((x): x is LineupPlayer => !!x);
      if (players.filter((p) => p.strSubstitute === "No").length >= 8) out.push(...players);
      else node.forEach(visit);
      return;
    }
    const rec = asRecord(node);
    if (!rec) return;
    Object.values(rec).forEach(visit);
  };
  visit(value);
  return out;
}

export function mapFifaLiveLineup(payload: unknown): LineupPlayer[] {
  const root = asRecord(payload);
  if (!root) return [];
  const homeNodes = [root.Home, root.HomeTeam, root.home, root.homeTeam].filter(Boolean);
  const awayNodes = [root.Away, root.AwayTeam, root.away, root.awayTeam].filter(Boolean);
  const players = [
    ...homeNodes.flatMap((node) => collectLineupRows(node, true)),
    ...awayNodes.flatMap((node) => collectLineupRows(node, false)),
  ];
  const seen = new Set<string>();
  return players.filter((p) => {
    const key = `${p.strHome}:${p.idPlayer ?? p.strPlayer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function withSquadPhotos(players: LineupPlayer[]): Promise<LineupPlayer[]> {
  const missing = players.filter((p) => !p.strThumb);
  if (!missing.length) return players;
  const squads = await fifaSquads().catch(() => []);
  const byId = new Map<string, FifaPlayer>();
  const byName = new Map<string, FifaPlayer>();
  for (const squad of squads) {
    for (const player of squad.Players) {
      byId.set(player.IdPlayer, player);
      byName.set(normalizeName(text(player.PlayerName)), player);
      if (text(player.ShortName)) byName.set(normalizeName(text(player.ShortName)), player);
    }
  }
  return players.map((p) => {
    if (p.strThumb) return p;
    const player = (p.idPlayer ? byId.get(p.idPlayer) : null) ?? byName.get(normalizeName(p.strPlayer));
    return player?.PlayerPicture?.PictureUrl ? { ...p, strThumb: player.PlayerPicture.PictureUrl } : p;
  });
}

export function isCompletePhotoLineup(players: LineupPlayer[]): boolean {
  const starters = players.filter((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
  const homeStarters = starters.filter((p) => p.strHome === "Yes");
  const awayStarters = starters.filter((p) => p.strHome === "No");
  return homeStarters.length === 11 && awayStarters.length === 11 && players.every((p) => !!p.strThumb);
}

export async function timeline(idEvent: string): Promise<TimelineItem[]> {
  const event = await eventDetail(idEvent);
  if (!event) return [];
  const items = await fifaTimeline(idEvent);
  return items.map((item) => mapFifaTimelineEvent(item, event, items)).filter((x): x is TimelineItem => !!x);
}

export async function lineup(idEvent?: string): Promise<LineupPlayer[]> {
  const event = idEvent ? await eventDetail(idEvent) : null;
  if (!event) return [];
  const live = await fifaLiveMatch(event.idEvent);
  const published = await withSquadPhotos(mapFifaLiveLineup(live));
  return isCompletePhotoLineup(published) ? published : [];
}

export async function eventStats(idEvent?: string): Promise<EventStat[]> {
  const event = idEvent ? await eventDetail(idEvent) : null;
  if (!idEvent || !event) return [];
  const items = await fifaTimeline(idEvent);
  const count = (teamId: string, names: RegExp) =>
    items.filter((item) => item.IdTeam === teamId && names.test(text(item.TypeLocalized))).length;
  return [
    {
      strStat: "Shots on Goal",
      intHome: String(count(event.idHomeTeam, /Attempt at Goal/i)),
      intAway: String(count(event.idAwayTeam, /Attempt at Goal/i)),
    },
    {
      strStat: "Corners",
      intHome: String(count(event.idHomeTeam, /^Corner$/i)),
      intAway: String(count(event.idAwayTeam, /^Corner$/i)),
    },
    {
      strStat: "Fouls",
      intHome: String(count(event.idHomeTeam, /^Foul$/i)),
      intAway: String(count(event.idAwayTeam, /^Foul$/i)),
    },
    {
      strStat: "Yellow Cards",
      intHome: String(count(event.idHomeTeam, /Yellow card/i)),
      intAway: String(count(event.idAwayTeam, /Yellow card/i)),
    },
    {
      strStat: "Red Cards",
      intHome: String(count(event.idHomeTeam, /Red card/i)),
      intAway: String(count(event.idAwayTeam, /Red card/i)),
    },
    {
      strStat: "Offsides",
      intHome: String(count(event.idHomeTeam, /^Offside$/i)),
      intAway: String(count(event.idAwayTeam, /^Offside$/i)),
    },
    {
      // "Goal Prevention" is FIFA's timeline label for a keeper's save on a shot on target.
      strStat: "Goalkeeper Saves",
      intHome: String(count(event.idHomeTeam, /Goal Prevention/i)),
      intAway: String(count(event.idAwayTeam, /Goal Prevention/i)),
    },
  ];
}

export async function possessionStat(idEvent: string): Promise<EventStat | null> {
  const live = asRecord(await fifaLiveMatch(idEvent));
  const possession = asRecord(live?.BallPossession);
  if (!possession) return null;
  const home = asString(possession.Home)
    ?? asString(possession.HomeTeam)
    ?? asString(possession.HomeTeamPossession)
    ?? asString(possession.HomePossession)
    ?? asString(possession.TeamA);
  const away = asString(possession.Away)
    ?? asString(possession.AwayTeam)
    ?? asString(possession.AwayTeamPossession)
    ?? asString(possession.AwayPossession)
    ?? asString(possession.TeamB);
  if (!home || !away) return null;
  return { strStat: "Ball Possession", intHome: home, intAway: away };
}

type FifaPlayerCareer = {
  InternationalCaps?: number | null;
  Goals?: number | null;
};

/** Career totals (caps, international goals) from the player's own FIFA profile —
 *  not present in the squad listing, which only has this tournament's roster info. */
async function withCareerStats(player: Player, idPlayer: string): Promise<Player> {
  const career = await getJson<FifaPlayerCareer>(`fifa:/players/${idPlayer}`, `${FIFA_BASE}/players/${idPlayer}`).catch(() => null);
  if (!career) return player;
  return { ...player, intInternationalCaps: career.InternationalCaps ?? null, intCareerGoals: career.Goals ?? null };
}

const playerCache = new Map<string, Player | null>();

export async function findPlayer(name: string): Promise<Player | null> {
  if (playerCache.has(name)) return playerCache.get(name)!;
  const norm = normalizeName(name);
  const squads = await fifaSquads().catch(() => []);
  const squad = squads.find((s) => s.Players.some((p) => normalizeName(text(p.PlayerName)) === norm || normalizeName(text(p.ShortName)) === norm));
  const player = squad?.Players.find((p) => normalizeName(text(p.PlayerName)) === norm || normalizeName(text(p.ShortName)) === norm);
  const result = player && squad ? await withCareerStats(mapFifaPlayer(player, text(squad.TeamName)), player.IdPlayer) : null;
  playerCache.set(name, result);
  return result;
}

const playerByIdCache = new Map<string, Player | null>();

export async function findPlayerById(idPlayer: string): Promise<Player | null> {
  if (playerByIdCache.has(idPlayer)) return playerByIdCache.get(idPlayer)!;
  const squads = await fifaSquads().catch(() => []);
  let result: Player | null = null;
  for (const squad of squads) {
    const player = squad.Players.find((p) => p.IdPlayer === idPlayer);
    if (player) { result = await withCareerStats(mapFifaPlayer(player, text(squad.TeamName)), idPlayer); break; }
  }
  playerByIdCache.set(idPlayer, result);
  return result;
}

function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

export function isLive(e: WcEvent): boolean {
  const s = (e.strStatus ?? "").toUpperCase();
  return s !== "" && s !== "NS" && !["FT", "AET", "PEN", "MATCH FINISHED"].includes(s);
}

export function isFinished(e: WcEvent): boolean {
  const s = (e.strStatus ?? "").toUpperCase();
  return ["FT", "AET", "PEN", "MATCH FINISHED"].includes(s);
}
