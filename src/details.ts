import type { WcEvent, LineupPlayer, EventStat } from "./types.ts";
import { eventStats, lineup } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMediaGroupStrict, sendMessage } from "./telegram.ts";

const STAT_PT: Record<string, string> = {
  "Shots on Goal": "Finalizações no gol",
  "Shots off Goal": "Finalizações para fora",
  "Total Shots": "Finalizações totais",
  "Blocked Shots": "Finalizações bloqueadas",
  "Shots insidebox": "Finalizações na área",
  "Shots outsidebox": "Finalizações de fora",
  "Ball Possession": "Posse de bola",
  "Fouls": "Faltas",
  "Corner Kicks": "Escanteios",
  "Offsides": "Impedimentos",
  "Yellow Cards": "Cartões amarelos",
  "Red Cards": "Cartões vermelhos",
  "Goalkeeper Saves": "Defesas do goleiro",
  "Total passes": "Passes totais",
  "Passes accurate": "Passes certos",
};

function parseStatValue(val: string | null): number {
  if (!val) return 0;
  const m = val.match(/^-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/** Mini horizontal bar comparing two numbers. */
function bar(h: number, a: number): string {
  const total = h + a || 1;
  const n = Math.round((h / total) * 10);
  return "▰".repeat(n) + "▱".repeat(10 - n);
}

function side(players: LineupPlayer[], home: boolean) {
  const list = players.filter((p) => ((p.strHome ?? "").toLowerCase() === "yes") === home);
  const xi = list.filter((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
  const subs = list.filter((p) => (p.strSubstitute ?? "").toLowerCase() === "yes");
  const line = (p: LineupPlayer) =>
    `   ${p.intSquadNumber ? `#${p.intSquadNumber} ` : ""}${p.strPlayer}${p.strPosition ? ` _(${p.strPosition})_` : ""}`;
  const out: string[] = [];
  if (xi.length) { out.push("  Titulares:"); out.push(...xi.map(line)); }
  if (subs.length) { out.push(xi.length ? "  Reservas:" : "  Elenco:"); out.push(...subs.map(line)); }
  return out;
}

function lineupPhotos(players: LineupPlayer[], home: boolean): string[] {
  return players
    .filter((p) => ((p.strHome ?? "").toLowerCase() === "yes") === home)
    .map((p) => p.strThumb)
    .filter((x): x is string => !!x);
}

export function fmtLineup(e: WcEvent, players: LineupPlayer[]): string {
  if (!players.length) return "";
  const home = side(players, true), away = side(players, false);
  const hasStarters = players.some((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
  if (!hasStarters) return "";
  const lines = [`📋 *ESCALAÇÕES OFICIAIS FIFA* — ${e.strHomeTeam} x ${e.strAwayTeam}`, ``];
  if (home.length) lines.push(`${flag(e.strHomeTeam)} *${e.strHomeTeam}*`, ...home, ``);
  if (away.length) lines.push(`${flag(e.strAwayTeam)} *${e.strAwayTeam}*`, ...away);
  return lines.join("\n");
}

export function fmtStats(e: WcEvent, stats: EventStat[]): string {
  if (!stats.length) return "";
  const rows = stats.map((s) => {
    const h = parseStatValue(s.intHome), a = parseStatValue(s.intAway);
    const name = STAT_PT[s.strStat] ?? s.strStat;
    return `*${s.intHome ?? "-"}* ${bar(h, a)} *${s.intAway ?? "-"}*\n_${name}_`;
  });
  return [
    `📈 *ESTATÍSTICAS* — ${flag(e.strHomeTeam)} ${e.strHomeTeam} x ${e.strAwayTeam} ${flag(e.strAwayTeam)}`,
    ``,
    ...rows,
  ].join("\n");
}

/** Send lineup + stats for an event (skips empty sections). */
export async function postDetails(e: WcEvent): Promise<void> {
  const [ls, st] = await Promise.all([lineup(e.idEvent), eventStats(e.idEvent)]);
  const lineupMsg = fmtLineup(e, ls);
  const statsMsg = fmtStats(e, st);
  if (lineupMsg) {
    for (const [team, photos] of [[e.strHomeTeam, lineupPhotos(ls, true)], [e.strAwayTeam, lineupPhotos(ls, false)]] as const) {
      for (let i = 0; i < photos.length; i += 10) {
        await sendMediaGroupStrict(photos.slice(i, i + 10), `📸 Escalação ${team}`);
      }
    }
    await sendMessage(lineupMsg);
  }
  if (statsMsg) await sendMessage(statsMsg);
}
