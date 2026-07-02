import type { WcEvent } from "./types.ts";
import { isFinished, mergedSeasonEvents } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage } from "./telegram.ts";

/** Finished matches that shipped an official FIFA highlight clip. */
export async function highlightMatches(): Promise<WcEvent[]> {
  const all = await mergedSeasonEvents();
  return all
    .filter(isFinished)
    .filter((e) => !!e.strVideo)
    .sort((a, b) => (b.strTimestamp ?? "").localeCompare(a.strTimestamp ?? ""));
}

export function fmtHighlights(events: WcEvent[]): string {
  if (!events.length) return "🎥 *MELHORES MOMENTOS* — _nenhum vídeo oficial disponível ainda._";
  const rows = events
    .slice(0, 15)
    .map((e) => `${flag(e.strHomeTeam)} *${e.strHomeTeam} ${e.intHomeScore} x ${e.intAwayScore} ${e.strAwayTeam}* ${flag(e.strAwayTeam)}\n   📺 ${e.strVideo}`);
  return [`🎥 *MELHORES MOMENTOS — Copa do Mundo 2026*`, ``, ...rows].join("\n\n");
}

export async function postHighlights(): Promise<WcEvent[]> {
  const events = await highlightMatches();
  await sendMessage(fmtHighlights(events), true); // preview embeds the clips
  return events;
}
