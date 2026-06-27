import { isFinished, isLive, mergedSeasonEvents, timeline, findPlayer } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { scorersChartUrl } from "./charts.ts";
import { fallbackGoals } from "./flashscore.ts";

export interface Scorer {
  player: string;
  team: string;
  goals: number;
}

const isGoal = (tl: { strTimeline: string; strTimelineDetail: string | null }) =>
  /goal/i.test(tl.strTimeline) && !/own|missed|disallow/i.test(tl.strTimelineDetail ?? "");

/** Aggregate goals per player across every played match of the season. */
export async function topScorers(): Promise<Scorer[]> {
  // Merged feed (season + recent day feeds) so live/just-finished matches count too.
  const all = await mergedSeasonEvents();
  const played = all.filter((e) => isFinished(e) || isLive(e));
  const tally = new Map<string, Scorer>();

  for (const e of played) {
    // Free key sometimes returns an empty timeline; fall back to Flashscore so a
    // scored match is never silently dropped from the standings.
    let goals = await timeline(e.idEvent);
    if (!goals.some(isGoal)) goals = await fallbackGoals(e).catch(() => []);
    for (const g of goals) {
      if (!isGoal(g) || !g.strPlayer) continue;
      const team = g.strTeam ?? "";
      const key = `${g.strPlayer}|${team}`;
      const cur = tally.get(key) ?? { player: g.strPlayer, team, goals: 0 };
      cur.goals++;
      tally.set(key, cur);
    }
  }
  return [...tally.values()].sort(
    (a, b) => b.goals - a.goals || a.player.localeCompare(b.player),
  );
}

export function fmtScorers(list: Scorer[]): string {
  if (!list.length) return "📊 *ARTILHARIA* — _sem gols registrados ainda._";
  const medal = (i: number) => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
  const rows = list
    .slice(0, 15)
    .map((s, i) => `${medal(i)} ${flag(s.team)} *${s.player}* (${s.team}) — *${s.goals}* ⚽️`);
  return [`📊 *ARTILHARIA — Copa do Mundo 2026*`, ``, ...rows].join("\n");
}

export async function postTopScorers(): Promise<Scorer[]> {
  const list = await topScorers();
  const leader = list[0];
  const pl = leader ? await findPlayer(leader.player) : null;
  const img = pl?.strCutout || pl?.strThumb;
  if (img) await sendPhoto(img, fmtScorers(list));
  else await sendMessage(fmtScorers(list));
  const chart = scorersChartUrl(list);
  if (chart) await sendPhoto(chart, "📊 Artilharia — Copa do Mundo 2026");
  return list;
}
