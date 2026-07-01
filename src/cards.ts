import { isFinished, isLive, mergedSeasonEvents, cardEvents } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { cardsChartUrl } from "./charts.ts";

export interface CardTally {
  player: string;
  team: string;
  yellow: number;
  red: number;
}

/** Aggregate yellow/red cards per player across every played match of the season. */
export async function topCards(): Promise<CardTally[]> {
  const all = await mergedSeasonEvents();
  const played = all.filter((e) => isFinished(e) || isLive(e));
  const tally = new Map<string, CardTally>();

  for (const e of played) {
    const cards = await cardEvents(e.idEvent);
    for (const c of cards) {
      if (!c.strPlayer) continue;
      const team = c.strTeam ?? "";
      const key = `${c.strPlayer}|${team}`;
      const cur = tally.get(key) ?? { player: c.strPlayer, team, yellow: 0, red: 0 };
      if (c.cardType === "red") cur.red++;
      else cur.yellow++;
      tally.set(key, cur);
    }
  }
  return [...tally.values()].sort(
    (a, b) => (b.red * 2 + b.yellow) - (a.red * 2 + a.yellow) || a.player.localeCompare(b.player),
  );
}

export function fmtCards(list: CardTally[]): string {
  if (!list.length) return "🟨 *CARTÕES* — _sem cartões registrados ainda._";
  const rows = list.slice(0, 15).map((c, i) => {
    const marks = [c.yellow ? `🟨${c.yellow > 1 ? `x${c.yellow}` : ""}` : "", c.red ? `🟥${c.red > 1 ? `x${c.red}` : ""}` : ""]
      .filter(Boolean)
      .join(" ");
    return `${i + 1}. ${flag(c.team)} *${c.player}* (${c.team}) — ${marks}`;
  });
  return [`🟨 *CARTÕES — Copa do Mundo 2026*`, ``, ...rows].join("\n");
}

export async function postTopCards(): Promise<CardTally[]> {
  const list = await topCards();
  const chart = cardsChartUrl(list);
  if (chart) await sendPhoto(chart, fmtCards(list));
  else await sendMessage(fmtCards(list));
  return list;
}
