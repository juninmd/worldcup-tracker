import type { WcEvent } from "./types.ts";
import { isFinished, mergedSeasonEvents } from "./sportsdb.ts";
import { flag, youtubeSearchLink } from "./format.ts";
import { sendMessage } from "./telegram.ts";

/** Finished matches, most recent first. FIFA's public match API exposes no
 *  highlight-clip URL (`strVideo` is always null from the official feed), so
 *  each match links out to a video search instead of an official embed. */
export async function highlightMatches(): Promise<WcEvent[]> {
  const all = await mergedSeasonEvents();
  return all
    .filter(isFinished)
    .sort((a, b) => (b.strTimestamp ?? "").localeCompare(a.strTimestamp ?? ""));
}

export function fmtHighlights(events: WcEvent[]): string {
  if (!events.length) return "🎥 *MELHORES MOMENTOS* — _nenhum jogo finalizado ainda._";
  const rows = events
    .slice(0, 15)
    .map((e) => {
      const query = `${e.strHomeTeam} x ${e.strAwayTeam} melhores momentos Copa do Mundo 2026`;
      return `${flag(e.strHomeTeam)} *${e.strHomeTeam} ${e.intHomeScore} x ${e.intAwayScore} ${e.strAwayTeam}* ${flag(e.strAwayTeam)}\n   📺 [buscar vídeo](${youtubeSearchLink(query)})`;
    });
  return [`🎥 *MELHORES MOMENTOS — Copa do Mundo 2026*`, ``, ...rows].join("\n\n");
}

export async function postHighlights(): Promise<WcEvent[]> {
  const events = await highlightMatches();
  await sendMessage(fmtHighlights(events), true); // preview shows the first search result's card
  return events;
}
