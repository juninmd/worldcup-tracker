import { cacheGet, cachePut, recordOperationalEvent } from "./db.ts";
import { canonicalTeam } from "./elo.ts";

// FotMob's undocumented public JSON API (Opta-sourced) — the one free, no-auth
// provider that answered from both dev and the cluster during homologation. Gives
// per-player match ratings + passing/xG that the official FIFA feed lacks. Used
// only to enrich analysis; FIFA stays the source of truth for fixtures/goals.
const FOTMOB_BASE = "https://www.fotmob.com/api/data";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TTL = 6 * 3_600_000; // a finished match's ratings never change

type FmMatch = { id: number; home?: { name?: string }; away?: { name?: string } };
type FmMatchesResp = { leagues?: { matches?: FmMatch[] }[] };
type FmStat = { value?: number; total?: number };
type FmPlayerStats = { name?: string; teamName?: string; stats?: { stats?: Record<string, { stat?: FmStat }> }[] };
type FmSide = { name?: string; rating?: number | string | null };
type FmDetails = { content?: { lineup?: { homeTeam?: FmSide; awayTeam?: FmSide }; playerStats?: Record<string, FmPlayerStats> } };

export interface FotmobPlayerLine {
  name: string;
  rating: number | null;
  passOk: number | null;
  passTotal: number | null;
  goals: number;
  assists: number;
  xg: number | null;
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

async function getJson<T>(cacheKey: string, url: string): Promise<T | null> {
  const started = Date.now();
  const observe = (outcome: "ok" | "cache" | "stale" | "error") =>
    recordOperationalEvent({ subsystem: "fotmob", operation: cacheKey, outcome, latencyMs: Date.now() - started });
  const hit = cacheGet(cacheKey);
  if (hit && hit.age < TTL) { observe("cache"); try { return JSON.parse(hit.body) as T; } catch { /* refetch */ } }
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) { if (hit) { observe("stale"); return JSON.parse(hit.body) as T; } observe("error"); return null; }
    const text = await res.text();
    cachePut(cacheKey, text);
    observe("ok");
    return JSON.parse(text) as T;
  } catch {
    if (hit) { observe("stale"); return JSON.parse(hit.body) as T; }
    observe("error");
    return null;
  }
}

/** Resolve a FIFA fixture (date + team names) to its FotMob match id. FotMob ids
 *  differ from FIFA's, so we match by date and both team names (order-insensitive). */
async function findMatchId(dateEvent: string, teamA: string, teamB: string): Promise<number | null> {
  const date = dateEvent.replaceAll("-", "");
  const resp = await getJson<FmMatchesResp>(`fotmob:/matches/${date}`, `${FOTMOB_BASE}/matches?date=${date}`);
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
  const details = await getJson<FmDetails>(`fotmob:/details/${matchId}`, `${FOTMOB_BASE}/matchDetails?matchId=${matchId}`);
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
  const passLine = (p: FotmobPlayerLine): string =>
    p.passTotal ? ` · passes ${p.passOk}/${p.passTotal} (${p.passTotal - (p.passOk ?? 0)} errados)` : "";
  return [
    `📈 *NOTAS DA PARTIDA (FotMob/Opta)* — ${ev.teamName} x ${ev.oppName}`,
    ev.teamRating !== null ? `Nota coletiva: ${ev.teamName} *${r1(ev.teamRating)}* x *${r1(ev.oppRating)}* ${ev.oppName}` : "",
    ``,
    `🔻 *Piores atuações do ${ev.teamName}:*`,
    ...worst.map((p) => `• ${p.name} — nota *${r1(p.rating)}*${passLine(p)}`),
    best ? `\n🔺 Melhor: ${best.name} — nota *${r1(best.rating)}*` : "",
    `_Fonte: FotMob (dados Opta). Nota e passes não existem na API FIFA._`,
  ].filter(Boolean).join("\n");
}

/** Compact real-performance lines for the LLM post-mortem — worst performers first,
 *  so "quem atrapalhou" can be named from actual ratings and wrong-pass counts. */
export function fotmobPerformanceLines(ev: FotmobMatchEval): string[] {
  return ev.players.slice(0, 6).map((p) => {
    const passes = p.passTotal ? `, ${p.passOk}/${p.passTotal} passes certos (${p.passTotal - (p.passOk ?? 0)} errados)` : "";
    return `${p.name}: nota ${r1(p.rating)}${passes}${p.goals ? `, ${p.goals} gol(s)` : ""}`;
  });
}
