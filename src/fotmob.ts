import { cacheGet, cachePut, recordOperationalEvent } from "./db.ts";
import { canonicalTeam } from "./elo.ts";

// FotMob's undocumented public JSON API (Opta-sourced) — the one free, no-auth
// provider that answered from both dev and the cluster during homologation. Gives
// per-player match ratings + passing/xG that the official FIFA feed lacks. Used
// only to enrich analysis; FIFA stays the source of truth for fixtures/goals.
const FOTMOB_BASE = "https://www.fotmob.com/api/data";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TTL_FINISHED = 6 * 3_600_000; // a finished match's ratings never change
const TTL_LIVE = 60_000; // 1 min for live / in-progress matches
const TTL_MATCHES_LIST = 5 * 60_000; // 5 min for fixture search / date listing

type FmMatch = { id: number; home?: { name?: string }; away?: { name?: string } };
type FmMatchesResp = { leagues?: { matches?: FmMatch[] }[] };
type FmStat = { value?: number; total?: number };
type FmPlayerStats = { name?: string; teamName?: string; stats?: { stats?: Record<string, { stat?: FmStat }> }[] };
type FmSide = { name?: string; rating?: number | string | null };
type FmDetails = {
  header?: { status?: { finished?: boolean; started?: boolean; cancelled?: boolean } };
  general?: { matchFinished?: boolean };
  content?: { lineup?: { homeTeam?: FmSide; awayTeam?: FmSide }; playerStats?: Record<string, FmPlayerStats> };
};

export interface FotmobPlayerLine {
  name: string;
  rating: number | null;
  passOk: number | null;
  passTotal: number | null;
  goals: number;
  assists: number;
  xg: number | null;
  // Ball-loss / duel metrics (Opta): perder a bola, ser driblado, perder duelo.
  dispossessed: number | null;
  dribbledPast: number | null;
  duelsLost: number | null;
}

export interface FotmobMatchEval {
  matchId: number;
  teamName: string;
  oppName: string;
  teamRating: number | null;
  oppRating: number | null;
  players: FotmobPlayerLine[]; // team's players, worst rating first
}

const norm = (name: string): string =>
  canonicalTeam(name).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z]/g, "");

async function getJson<T>(cacheKey: string, url: string, ttlMs = TTL_FINISHED): Promise<T | null> {
  const started = Date.now();
  const observe = (outcome: "ok" | "cache" | "stale" | "error") =>
    recordOperationalEvent({ subsystem: "fotmob", operation: cacheKey, outcome, latencyMs: Date.now() - started });
  const hit = cacheGet(cacheKey);
  if (hit && hit.age < ttlMs) {
    try {
      const parsed = JSON.parse(hit.body) as T;
      observe("cache");
      return parsed;
    } catch {
      /* corrupted cache entry, refetch below */
    }
  }

  const safeParseStale = (): T | null => {
    if (!hit) return null;
    try {
      return JSON.parse(hit.body) as T;
    } catch {
      return null;
    }
  };

  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const stale = safeParseStale();
      if (stale !== null) {
        observe("stale");
        return stale;
      }
      observe("error");
      return null;
    }
    const text = await res.text();
    cachePut(cacheKey, text);
    observe("ok");
    return JSON.parse(text) as T;
  } catch {
    const stale = safeParseStale();
    if (stale !== null) {
      observe("stale");
      return stale;
    }
    observe("error");
    return null;
  }
}

/** Resolve a FIFA fixture (date + team names) to its FotMob match id. FotMob ids
 *  differ from FIFA's, so we match by date and both team names (order-insensitive). */
export async function findMatchId(dateEvent: string, teamA: string, teamB: string): Promise<number | null> {
  const date = dateEvent.replaceAll("-", "");
  const resp = await getJson<FmMatchesResp>(`fotmob:/matches/${date}`, `${FOTMOB_BASE}/matches?date=${date}`, TTL_MATCHES_LIST);
  const a = norm(teamA), b = norm(teamB);
  for (const league of resp?.leagues ?? []) {
    for (const m of league.matches ?? []) {
      const h = norm(m.home?.name ?? ""), w = norm(m.away?.name ?? "");
      if ((h === a && w === b) || (h === b && w === a)) return m.id;
    }
  }
  return null;
}

function stat(p: FmPlayerStats, label: string): FmStat | null {
  for (const group of p.stats ?? []) {
    const s = group.stats?.[label]?.stat;
    if (s) return s;
  }
  return null;
}

const toNum = (v: number | string | null | undefined): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
};

/** Per-player ratings + passing/xG for one team in a match, worst rating first. */
export async function fotmobEval(dateEvent: string, teamName: string, oppName: string): Promise<FotmobMatchEval | null> {
  const matchId = await findMatchId(dateEvent, teamName, oppName);
  if (matchId === null) return null;
  // Determine if match is live or finished to use proper cache TTL (6h for finished, 1m for live/in-progress)
  const hit = cacheGet(`fotmob:/details/${matchId}`);
  let candidateTtl = TTL_LIVE;
  if (hit) {
    try {
      const cached = JSON.parse(hit.body) as FmDetails;
      const isFinished = cached.header?.status?.finished ?? cached.general?.matchFinished ?? false;
      if (isFinished) candidateTtl = TTL_FINISHED;
    } catch {
      /* invalid cache */
    }
  }
  const details = await getJson<FmDetails>(
    `fotmob:/details/${matchId}`,
    `${FOTMOB_BASE}/matchDetails?matchId=${matchId}`,
    candidateTtl,
  );
  const stats = details?.content?.playerStats;
  if (!stats) return null;
  const wanted = norm(teamName);
  const players: FotmobPlayerLine[] = [];
  for (const p of Object.values(stats)) {
    if (norm(p.teamName ?? "") !== wanted || !p.name) continue;
    const passes = stat(p, "Accurate passes");
    players.push({
      name: p.name,
      rating: stat(p, "FotMob rating")?.value ?? null,
      passOk: passes?.value ?? null,
      passTotal: passes?.total ?? null,
      goals: stat(p, "Goals")?.value ?? 0,
      assists: stat(p, "Assists")?.value ?? 0,
      xg: stat(p, "Expected goals (xG)")?.value ?? null,
      dispossessed: stat(p, "Dispossessed")?.value ?? null,
      dribbledPast: stat(p, "Dribbled past")?.value ?? null,
      duelsLost: stat(p, "Duels lost")?.value ?? null,
    });
  }
  if (!players.length) return null;
  players.sort((x, y) => (x.rating ?? 99) - (y.rating ?? 99));
  const sideRating = (side?: FmSide): number | null =>
    side && norm(side.name ?? "") === wanted ? toNum(side.rating) : null;
  const home = details?.content?.lineup?.homeTeam, away = details?.content?.lineup?.awayTeam;
  return {
    matchId,
    teamName,
    oppName,
    teamRating: sideRating(home) ?? sideRating(away),
    oppRating: (norm(home?.name ?? "") === wanted ? toNum(away?.rating) : toNum(home?.rating)),
    players,
  };
}

const r1 = (n: number | null): string => (n === null ? "n/d" : n.toFixed(1).replace(".", ","));

/** Real match evaluation (ratings + wrong passes) for a Brazil match, as a Telegram
 *  block. Names are all real (FotMob/Opta) — the only honest way to point fingers. */
export function fmtFotmobEval(ev: FotmobMatchEval): string {
  const rated = ev.players.filter((p) => p.rating !== null);
  const worst = rated.slice(0, 5);
  const best = rated.at(-1); // players are sorted worst→best, nulls excluded here
  const detail = (p: FotmobPlayerLine): string => {
    const bits: string[] = [];
    if (p.passTotal) bits.push(`passes ${p.passOk}/${p.passTotal} (${p.passTotal - (p.passOk ?? 0)} err)`);
    if (p.dispossessed) bits.push(`perdeu a bola ${p.dispossessed}x`);
    if (p.dribbledPast) bits.push(`driblado ${p.dribbledPast}x`);
    if (p.duelsLost) bits.push(`${p.duelsLost} duelos perd.`);
    return bits.length ? ` · ${bits.join(" · ")}` : "";
  };
  const mostDribbled = [...rated].sort((a, b) => (b.dribbledPast ?? 0) - (a.dribbledPast ?? 0))[0];
  const mostDuelsLost = [...rated].sort((a, b) => (b.duelsLost ?? 0) - (a.duelsLost ?? 0))[0];
  return [
    `📈 *NOTAS DA PARTIDA (FotMob/Opta)* — ${ev.teamName} x ${ev.oppName}`,
    ev.teamRating !== null ? `Nota coletiva: ${ev.teamName} *${r1(ev.teamRating)}* x *${r1(ev.oppRating)}* ${ev.oppName}` : "",
    ``,
    `🔻 *Piores atuações do ${ev.teamName}:*`,
    ...worst.map((p) => `• ${p.name} — nota *${r1(p.rating)}*${detail(p)}`),
    ``,
    mostDribbled?.dribbledPast ? `🥴 Mais desarmado (driblado): *${mostDribbled.name}* (${mostDribbled.dribbledPast}x)` : "",
    mostDuelsLost?.duelsLost ? `💢 Mais perdeu duelos: *${mostDuelsLost.name}* (${mostDuelsLost.duelsLost})` : "",
    best ? `🔺 Melhor: ${best.name} — nota *${r1(best.rating)}*` : "",
    `_Fonte: FotMob (dados Opta). Nota, passes e perda de bola não existem na API FIFA._`,
  ].filter(Boolean).join("\n");
}

/** Compact real-performance lines for the LLM post-mortem — worst performers first,
 *  so "quem atrapalhou" can be named from actual ratings and wrong-pass counts. */
export function fotmobPerformanceLines(ev: FotmobMatchEval): string[] {
  return ev.players.slice(0, 6).map((p) => {
    const bits: string[] = [];
    if (p.passTotal) bits.push(`${p.passTotal - (p.passOk ?? 0)} passes errados de ${p.passTotal}`);
    if (p.dispossessed) bits.push(`perdeu a bola ${p.dispossessed}x`);
    if (p.dribbledPast) bits.push(`driblado ${p.dribbledPast}x`);
    if (p.duelsLost) bits.push(`${p.duelsLost} duelos perdidos`);
    if (p.goals) bits.push(`${p.goals} gol(s)`);
    return `${p.name}: nota ${r1(p.rating)}${bits.length ? ` — ${bits.join(", ")}` : ""}`;
  });
}
