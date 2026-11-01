import { cacheGet, cachePut, recordOperationalEvent } from "./db.ts";
import { fetchLeagueTable, type LeagueRow } from "./leagues.ts";
import { fetchNews, type NewsItem } from "./news.ts";
import { sendMessage } from "./telegram.ts";

export interface SelecaoMatchInfo {
  opponent: string;
  isHome: boolean;
  scoreStr?: string;
  tournament: string;
  utcTime: string;
  brtTime: string;
}

export interface SelecaoHubData {
  nextMatch: SelecaoMatchInfo | null;
  lastMatch: SelecaoMatchInfo | null;
  qualifiersRow: LeagueRow | null;
  news: NewsItem[];
}

const BRAZIL_TEAM_ID = 8256;
const TTL_MS = 30 * 60_000; // 30 min
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export function formatBrt(utcIso: string): string {
  try {
    const d = new Date(utcIso);
    if (Number.isNaN(d.getTime())) return utcIso;
    return d.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return utcIso;
  }
}

export function parseTeamMatch(matchObj: any, defaultHome = false): SelecaoMatchInfo | null {
  if (!matchObj) return null;
  const opp = matchObj.opponent?.name ?? "Adversário";
  const isHome = matchObj.home?.id === BRAZIL_TEAM_ID;
  const tournament = matchObj.tournament?.name ?? "Amistoso";
  const utcTime = matchObj.status?.utcTime ?? "";
  const scoreStr = matchObj.status?.scoreStr ?? undefined;

  return {
    opponent: opp,
    isHome,
    tournament,
    scoreStr,
    utcTime,
    brtTime: utcTime ? formatBrt(utcTime) : "A definir",
  };
}

export async function fetchSelecaoData(): Promise<SelecaoHubData> {
  const cacheKey = `fotmob:team:${BRAZIL_TEAM_ID}`;
  const started = Date.now();
  const observe = (outcome: "ok" | "cache" | "stale" | "error") =>
    recordOperationalEvent({
      subsystem: "fotmob",
      operation: cacheKey,
      outcome,
      latencyMs: Date.now() - started,
    });

  let rawTeamData: any = null;
  const hit = cacheGet(cacheKey);

  if (hit && hit.age < TTL_MS) {
    observe("cache");
    try {
      rawTeamData = JSON.parse(hit.body);
    } catch {
      // refetch
    }
  }

  if (!rawTeamData) {
    try {
      const url = `https://www.fotmob.com/api/data/teams?id=${BRAZIL_TEAM_ID}`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const text = await res.text();
        cachePut(cacheKey, text);
        observe("ok");
        rawTeamData = JSON.parse(text);
      } else if (hit) {
        observe("stale");
        rawTeamData = JSON.parse(hit.body);
      } else {
        observe("error");
      }
    } catch {
      if (hit) {
        observe("stale");
        rawTeamData = JSON.parse(hit.body);
      } else {
        observe("error");
      }
    }
  }

  const [table, news] = await Promise.all([
    fetchLeagueTable("eliminatorias").catch(() => null),
    fetchNews("selecao").catch(() => []),
  ]);

  const qualifiersRow =
    table?.rows.find(
      (r) =>
        r.name.toLowerCase().includes("brazil") ||
        r.name.toLowerCase().includes("brasil") ||
        r.shortName.toLowerCase().includes("brazil") ||
        r.shortName.toLowerCase().includes("brasil"),
    ) ?? null;

  return {
    nextMatch: parseTeamMatch(rawTeamData?.overview?.nextMatch, false),
    lastMatch: parseTeamMatch(rawTeamData?.overview?.lastMatch, false),
    qualifiersRow,
    news: news.slice(0, 3),
  };
}

export function fmtSelecaoHub(data: SelecaoHubData): string {
  const lines: string[] = ["🇧🇷 *Seleção Brasileira — Hub 360°*\n"];

  // Próximo jogo
  if (data.nextMatch) {
    const m = data.nextMatch;
    const loc = m.isHome ? "Brasil x " + m.opponent : m.opponent + " x Brasil";
    lines.push(`📅 *Próximo Jogo:*\n${loc} (${m.tournament})\n🗓 ${m.brtTime} (horário de Brasília)\n`);
  } else {
    lines.push("📅 *Próximo Jogo:*\nNenhum jogo confirmado no momento.\n");
  }

  // Último jogo
  if (data.lastMatch) {
    const m = data.lastMatch;
    const score = m.scoreStr ? `— Placar: ${m.scoreStr}` : "";
    lines.push(`⏮ *Último Resultado:*\nvs ${m.opponent} (${m.tournament}) ${score}\n🗓 ${m.brtTime}\n`);
  }

  // Eliminatórias
  if (data.qualifiersRow) {
    const q = data.qualifiersRow;
    const zone =
      q.idx <= 6
        ? "✅ Zona de vaga direta (G6)"
        : q.idx === 7
          ? "⚠️ Zona de repescagem mundial (7º)"
          : "❌ Fora da zona de classificação";
    const sg = q.goalConDiff > 0 ? `+${q.goalConDiff}` : String(q.goalConDiff);
    lines.push(
      `🏆 *Eliminatórias Copa do Mundo (CONMEBOL):*\n${q.idx}º lugar · ${q.pts} pts (${q.played}J, ${q.wins}V, ${q.draws}E, ${q.losses}D, SG ${sg})\n${zone}\n`,
    );
  }

  // Notícias
  if (data.news.length > 0) {
    lines.push("📰 *Últimas Notícias (ge.globo):*");
    for (const n of data.news) {
      lines.push(`• [${n.title}](${n.link})`);
    }
  }

  return lines.join("\n").trim();
}

export async function postSelecaoHub(): Promise<void> {
  const data = await fetchSelecaoData();
  const msg = fmtSelecaoHub(data);
  await sendMessage(msg);
}
