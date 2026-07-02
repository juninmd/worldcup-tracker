import type { WcEvent } from "./types.ts";
import { isLive, mergedSeasonEvents } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage } from "./telegram.ts";

/** Matches currently in progress, per the official FIFA live status feed. */
export async function liveMatches(): Promise<WcEvent[]> {
  const all = await mergedSeasonEvents();
  return all.filter(isLive).sort((a, b) => (a.strTimestamp ?? "").localeCompare(b.strTimestamp ?? ""));
}

export function fmtLive(events: WcEvent[]): string {
  if (!events.length) return "🔴 *AO VIVO* — _nenhuma partida em andamento agora._";
  const rows = events.map((e) => {
    const minute = e.strProgress ? `${e.strProgress}'` : e.strStatus ?? "";
    const venue = [e.strVenue, e.strCity].filter(Boolean).join(", ");
    return `${flag(e.strHomeTeam)} *${e.strHomeTeam} ${e.intHomeScore ?? 0} x ${e.intAwayScore ?? 0} ${e.strAwayTeam}* ${flag(e.strAwayTeam)} — 🕒 ${minute}${venue ? `\n   📍 ${venue}` : ""}`;
  });
  return [`🔴 *AO VIVO — Copa do Mundo 2026*`, ``, ...rows].join("\n\n");
}

export async function postLive(): Promise<WcEvent[]> {
  const events = await liveMatches();
  await sendMessage(fmtLive(events));
  return events;
}
