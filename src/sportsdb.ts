import { cacheGet, cachePut } from "./db.ts";
import type { WcEvent, TimelineItem, Player, LineupPlayer, EventStat, TableRow, CardEvent, IntensityBucket } from "./types.ts";

const FIFA_BASE = "https://api.fifa.com/api/v3";
const FIFA_COMPETITION_ID = "17";
const FIFA_SEASON_ID = "285023";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ttlFor(path: string): number {
  if (path.startsWith("fifa:/calendar/matches")) return 20_000;
  if (path.startsWith("fifa:/timelines/")) return 15_000;
  if (path.startsWith("fifa:/teams/squads")) return 6 * 3_600_000;
  return 20_000;
}

async function getJson<T>(cachePath: string, url: string): Promise<T> {
  const hit = cacheGet(cachePath);
  if (hit && hit.age < ttlFor(cachePath)) return JSON.parse(hit.body) as T;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "worldcup-tracker/1.0" } });
    } catch (err) {
      if (hit) return JSON.parse(hit.body) as T;
      throw err;
    }
    if (res.ok) {
      const text = await res.text();
      cachePut(cachePath, text);
      return JSON.parse(text) as T;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (hit) return JSON.parse(hit.body) as T;
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
    intHomeScore: match.HomeTeamScore === null || match.HomeTeamScore === undefined ? null : String(match.HomeTeamScore),
    intAwayScore: match.AwayTeamScore === null || match.AwayTeamScore === undefined ? null : String(match.AwayTeamScore),
    strVenue: text(match.Stadium?.Name),
    strLeague: "FIFA World Cup",
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

export function mapFifaTimelineEvent(item: FifaTimelineEvent, e: WcEvent): TimelineItem | null {
  const kind = text(item.TypeLocalized);
  if (![0, 34, 41].includes(item.Type ?? -1) && !/^(own goal|penalty goal|goal!?)$/i.test(kind)) return null;
  const description = text(item.EventDescription);
  const eventTeam = item.IdTeam === e.idHomeTeam ? e.strHomeTeam : item.IdTeam === e.idAwayTeam ? e.strAwayTeam : null;
  const team = /own goal/i.test(kind)
    ? eventTeam === e.strHomeTeam ? e.strAwayTeam : eventTeam === e.strAwayTeam ? e.strHomeTeam : null
    : eventTeam;
  return {
    idTimeline: item.EventId,
    intTime: item.MatchMinute?.replace("'", "") ?? "",
    strTimeline: "Goal",
    strTimelineDetail: kind,
    strHome: team === e.strHomeTeam ? "yes" : "no",
    strPlayer: team ? playerFromDescription(description) : null,
    strTeam: team,
    idPlayer: item.IdPlayer ?? null,
    strAssist: null,
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
  return (await fifaTimeline(idEvent)).map((item) => mapFifaTimelineEvent(item, event)).filter((x): x is TimelineItem => !!x);
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
  ];
}

const playerCache = new Map<string, Player | null>();

export async function findPlayer(name: string): Promise<Player | null> {
  if (playerCache.has(name)) return playerCache.get(name)!;
  const norm = normalizeName(name);
  const squads = await fifaSquads().catch(() => []);
  const squad = squads.find((s) => s.Players.some((p) => normalizeName(text(p.PlayerName)) === norm || normalizeName(text(p.ShortName)) === norm));
  const player = squad?.Players.find((p) => normalizeName(text(p.PlayerName)) === norm || normalizeName(text(p.ShortName)) === norm);
  const result = player && squad ? mapFifaPlayer(player, text(squad.TeamName)) : null;
  playerCache.set(name, result);
  return result;
}

export async function findPlayerById(idPlayer: string): Promise<Player | null> {
  const squads = await fifaSquads().catch(() => []);
  for (const squad of squads) {
    const player = squad.Players.find((p) => p.IdPlayer === idPlayer);
    if (player) return mapFifaPlayer(player, text(squad.TeamName));
  }
  return null;
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
