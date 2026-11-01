import { cacheGet, cachePut, recordOperationalEvent } from "./db.ts";
import { sendMessage } from "./telegram.ts";

export type SupportedLeague =
  | "brasileirao"
  | "libertadores"
  | "champions"
  | "premier"
  | "laliga"
  | "eliminatorias";

export interface LeagueMeta {
  id: number;
  name: string;
  emoji: string;
  shortLabel: string;
}

export const LEAGUES_CONFIG: Record<SupportedLeague, LeagueMeta> = {
  brasileirao: {
    id: 268,
    name: "Brasileirão Série A",
    emoji: "🇧🇷",
    shortLabel: "Brasileirão",
  },
  libertadores: {
    id: 45,
    name: "Copa Libertadores",
    emoji: "⭐",
    shortLabel: "Libertadores",
  },
  champions: {
    id: 42,
    name: "UEFA Champions League",
    emoji: "🌍",
    shortLabel: "Champions",
  },
  premier: {
    id: 47,
    name: "Premier League",
    emoji: "🦁",
    shortLabel: "Premier League",
  },
  laliga: {
    id: 87,
    name: "LaLiga",
    emoji: "🇪🇸",
    shortLabel: "LaLiga",
  },
  eliminatorias: {
    id: 10199,
    name: "Eliminatórias Copa do Mundo (CONMEBOL)",
    emoji: "🏆",
    shortLabel: "Eliminatórias",
  },
};

export interface LeagueRow {
  idx: number;
  name: string;
  shortName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoresStr: string;
  goalConDiff: number;
  pts: number;
  qualColor?: string | null;
}

export interface LeagueTable {
  league: SupportedLeague;
  name: string;
  season?: string;
  rows: LeagueRow[];
}

const TTL_MS = 15 * 60_000; // 15 min
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export function extractRows(data: any): LeagueRow[] {
  const rawList =
    data?.table?.[0]?.data?.table?.all ??
    data?.table?.[0]?.data?.tables?.[0]?.table?.all ??
    data?.table?.[0]?.data?.composite ??
    [];

  return rawList.map((r: any, i: number) => ({
    idx: r.idx ?? i + 1,
    name: r.name ?? r.shortName ?? "Time",
    shortName: r.shortName ?? r.name ?? "Time",
    played: Number(r.played ?? 0),
    wins: Number(r.wins ?? 0),
    draws: Number(r.draws ?? 0),
    losses: Number(r.losses ?? 0),
    scoresStr: r.scoresStr ?? "0-0",
    goalConDiff: Number(r.goalConDiff ?? 0),
    pts: Number(r.pts ?? 0),
    qualColor: r.qualColor ?? null,
  }));
}

export async function fetchLeagueTable(league: SupportedLeague): Promise<LeagueTable> {
  const meta = LEAGUES_CONFIG[league];
  if (!meta) throw new Error(`Liga desconhecida: ${league}`);

  const cacheKey = `fotmob:league:${meta.id}`;
  const started = Date.now();
  const observe = (outcome: "ok" | "cache" | "stale" | "error") =>
    recordOperationalEvent({
      subsystem: "fotmob",
      operation: cacheKey,
      outcome,
      latencyMs: Date.now() - started,
    });

  const hit = cacheGet(cacheKey);
  if (hit && hit.age < TTL_MS) {
    observe("cache");
    try {
      const parsed = JSON.parse(hit.body);
      return {
        league,
        name: parsed.details?.name ?? meta.name,
        season: parsed.details?.selectedSeason,
        rows: extractRows(parsed),
      };
    } catch {
      // refetch
    }
  }

  const url = `https://www.fotmob.com/api/data/leagues?id=${meta.id}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const text = await res.text();
      cachePut(cacheKey, text);
      observe("ok");
      const parsed = JSON.parse(text);
      return {
        league,
        name: parsed.details?.name ?? meta.name,
        season: parsed.details?.selectedSeason,
        rows: extractRows(parsed),
      };
    }

    if (hit) {
      observe("stale");
      const parsed = JSON.parse(hit.body);
      return {
        league,
        name: parsed.details?.name ?? meta.name,
        season: parsed.details?.selectedSeason,
        rows: extractRows(parsed),
      };
    }
    observe("error");
    return { league, name: meta.name, rows: [] };
  } catch {
    if (hit) {
      observe("stale");
      const parsed = JSON.parse(hit.body);
      return {
        league,
        name: parsed.details?.name ?? meta.name,
        season: parsed.details?.selectedSeason,
        rows: extractRows(parsed),
      };
    }
    observe("error");
    return { league, name: meta.name, rows: [] };
  }
}

export function fmtLeagueTable(table: LeagueTable, limit = 10): string {
  const meta = LEAGUES_CONFIG[table.league];
  const rows = table.rows.slice(0, limit);

  if (rows.length === 0) {
    return `${meta?.emoji ?? "⚽"} *${table.name} — Classificação*\n\nNenhuma informação de tabela disponível no momento.`;
  }

  const header = `${meta?.emoji ?? "⚽"} *${table.name} — Classificação*`;
  const sub = table.season ? `_Temporada: ${table.season}_\n` : "";

  const tableHeader = "`#   Time            J   V   E   D   SG  Pts`";
  const tableRows = rows.map((r) => {
    const pos = String(r.idx).padEnd(3);
    const rawName = r.shortName.length > 13 ? r.shortName.slice(0, 12) + "…" : r.shortName;
    const name = rawName.padEnd(14);
    const j = String(r.played).padStart(3);
    const v = String(r.wins).padStart(3);
    const e = String(r.draws).padStart(3);
    const d = String(r.losses).padStart(3);
    const sg = (r.goalConDiff > 0 ? `+${r.goalConDiff}` : String(r.goalConDiff)).padStart(4);
    const pts = String(r.pts).padStart(4);
    return `\`${pos} ${name} ${j} ${v} ${e} ${d} ${sg} ${pts}\``;
  });

  return [header, sub, tableHeader, ...tableRows].filter(Boolean).join("\n").trim();
}

export async function postLeagueTable(league: SupportedLeague, limit = 10): Promise<void> {
  const table = await fetchLeagueTable(league);
  const msg = fmtLeagueTable(table, limit);
  await sendMessage(msg);
}
