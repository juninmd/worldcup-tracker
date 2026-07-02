import { isFinished, isLive, mergedSeasonEvents, timeline } from "./sportsdb.ts";
import { sendMessage } from "./telegram.ts";

const isGoal = (tl: { strTimeline: string; strTimelineDetail: string | null }) =>
  /goal/i.test(tl.strTimeline) && !/missed|disallow/i.test(tl.strTimelineDetail ?? "");

const BUCKETS = ["1-15", "16-30", "31-45", "45+", "46-60", "61-75", "76-90", "90+"] as const;
export type Bucket = typeof BUCKETS[number];

function bucketOf(minute: number, isFirstHalf: boolean): Bucket {
  if (isFirstHalf) {
    if (minute <= 15) return "1-15";
    if (minute <= 30) return "16-30";
    if (minute <= 45) return "31-45";
    return "45+";
  }
  if (minute <= 60) return "46-60";
  if (minute <= 75) return "61-75";
  if (minute <= 90) return "76-90";
  return "90+";
}

/** Distribution of every tracked goal across the match clock, tournament-wide. */
export async function goalTimeDistribution(): Promise<Record<Bucket, number>> {
  const all = await mergedSeasonEvents();
  const played = all.filter((e) => isFinished(e) || isLive(e));
  const tally = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  let firstHalf = true;

  for (const e of played) {
    const goals = await timeline(e.idEvent);
    for (const g of goals) {
      if (!isGoal(g)) continue;
      const minute = Number(g.intTime) || 0;
      firstHalf = minute <= 45;
      tally[bucketOf(minute, firstHalf)]++;
    }
  }
  return tally;
}

export function fmtGoalTimes(tally: Record<Bucket, number>): string {
  const total = Object.values(tally).reduce((s, n) => s + n, 0);
  if (!total) return "⏱ *GOLS POR MINUTO* — _nenhum gol registrado ainda._";
  const rows = BUCKETS.map((b) => {
    const n = tally[b];
    const pct = total ? Math.round((n / total) * 100) : 0;
    const bar = "▰".repeat(Math.round(pct / 5)) + "▱".repeat(20 - Math.round(pct / 5));
    return `${b.padEnd(6)} ${bar} ${n} (${pct}%)`;
  });
  return [`⏱ *GOLS POR FAIXA DE MINUTO — Copa do Mundo 2026*`, `_${total} gols analisados_`, ``, "```", ...rows, "```"].join("\n");
}

export async function postGoalTimes(): Promise<Record<Bucket, number>> {
  const tally = await goalTimeDistribution();
  await sendMessage(fmtGoalTimes(tally));
  return tally;
}
