import { isFinished, mergedSeasonEvents } from "./sportsdb.ts";
import { sendMessage } from "./telegram.ts";

export interface VenueEntry {
  venue: string;
  city: string | null;
  matches: number;
  totalAttendance: number;
  avgAttendance: number;
}

/** Aggregate crowds per stadium across every finished match of the season. */
export async function venueTable(): Promise<VenueEntry[]> {
  const finished = (await mergedSeasonEvents()).filter(isFinished).filter((e) => e.strVenue);
  const tally = new Map<string, VenueEntry>();

  for (const e of finished) {
    const key = e.strVenue!;
    const cur = tally.get(key) ?? { venue: key, city: e.strCity ?? null, matches: 0, totalAttendance: 0, avgAttendance: 0 };
    cur.matches++;
    cur.totalAttendance += Number(e.intSpectators) || 0;
    tally.set(key, cur);
  }
  return [...tally.values()]
    .map((v) => ({ ...v, avgAttendance: v.matches ? Math.round(v.totalAttendance / v.matches) : 0 }))
    .sort((a, b) => b.totalAttendance - a.totalAttendance);
}

export function fmtVenues(list: VenueEntry[]): string {
  if (!list.length) return "🏟 *ESTÁDIOS* — _sem jogos disputados ainda._";
  const rows = list.map((v) =>
    `🏟 *${v.venue}*${v.city ? ` (${v.city})` : ""} — ${v.matches} jogo${v.matches !== 1 ? "s" : ""} · público médio ${v.avgAttendance.toLocaleString("pt-BR")} · total ${v.totalAttendance.toLocaleString("pt-BR")}`
  );
  return [`🏟 *PÚBLICO POR ESTÁDIO — Copa do Mundo 2026*`, ``, ...rows].join("\n");
}

export async function postVenues(): Promise<VenueEntry[]> {
  const list = await venueTable();
  await sendMessage(fmtVenues(list));
  return list;
}
