import type { WcEvent } from "./types.ts";
import { outcomeOf } from "./elo.ts";
import { isFinished, mergedSeasonEvents } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage } from "./telegram.ts";

export interface StreakEntry {
  team: string;
  kind: "win" | "unbeaten" | "loss" | "scoring";
  length: number;
}

/** Current active streak per team (most recent finished match backwards). */
export async function streaks(): Promise<StreakEntry[]> {
  const finished = (await mergedSeasonEvents()).filter(isFinished);
  const byTeam = new Map<string, WcEvent[]>();
  for (const e of finished) {
    (byTeam.get(e.strHomeTeam) ?? byTeam.set(e.strHomeTeam, []).get(e.strHomeTeam)!).push(e);
    (byTeam.get(e.strAwayTeam) ?? byTeam.set(e.strAwayTeam, []).get(e.strAwayTeam)!).push(e);
  }

  const out: StreakEntry[] = [];
  for (const [team, games] of byTeam) {
    const sorted = [...games].sort((a, b) => (b.strTimestamp ?? b.dateEvent).localeCompare(a.strTimestamp ?? a.dateEvent));
    let wins = 0, unbeaten = 0, losses = 0, scoring = 0;
    let stopWins = false, stopUnbeaten = false, stopLosses = false, stopScoring = false;
    for (const e of sorted) {
      const o = outcomeOf(e);
      if (!o) continue;
      const isHome = e.strHomeTeam === team;
      const won = (isHome && o.result === "H") || (!isHome && o.result === "A");
      const lost = (isHome && o.result === "A") || (!isHome && o.result === "H");
      const goalsFor = isHome ? o.home : o.away;
      if (!stopWins) { if (won) wins++; else stopWins = true; }
      if (!stopLosses) { if (lost) losses++; else stopLosses = true; }
      if (!stopUnbeaten) { if (!lost) unbeaten++; else stopUnbeaten = true; }
      if (!stopScoring) { if (goalsFor > 0) scoring++; else stopScoring = true; }
    }
    if (wins >= 2) out.push({ team, kind: "win", length: wins });
    else if (losses >= 2) out.push({ team, kind: "loss", length: losses });
    else if (unbeaten >= 3) out.push({ team, kind: "unbeaten", length: unbeaten });
    if (scoring >= 3) out.push({ team, kind: "scoring", length: scoring });
  }
  return out.sort((a, b) => b.length - a.length);
}

const LABEL: Record<StreakEntry["kind"], string> = {
  win: "🔥 vitórias seguidas",
  unbeaten: "🛡 invicto",
  loss: "📉 derrotas seguidas",
  scoring: "⚽️ jogos seguidos marcando",
};

export function fmtStreaks(list: StreakEntry[]): string {
  if (!list.length) return "📊 *SEQUÊNCIAS* — _sem sequências relevantes ainda._";
  const rows = list.map((s) => `${flag(s.team)} *${s.team}* — ${s.length} ${LABEL[s.kind]}`);
  return [`📊 *SEQUÊNCIAS — Copa do Mundo 2026*`, ``, ...rows].join("\n");
}

export async function postStreaks(): Promise<StreakEntry[]> {
  const list = await streaks();
  await sendMessage(fmtStreaks(list));
  return list;
}
