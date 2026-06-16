import type { WcEvent, TimelineItem } from "./types.ts";
import { eventsOnDate, findPlayer, isFinished, isLive, seasonEvents, timeline } from "./sportsdb.ts";
import { trainRatings, outcomeOf } from "./elo.ts";
import { predictMatch } from "./predict.ts";
import { championForecast } from "./champion.ts";
import { fmtDailyMenu, fmtFulltime, fmtGoalCaption, fmtPrematch, fmtScoreGoal } from "./format.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { goalKey, loadState, saveState } from "./state.ts";
import { config } from "./config.ts";
import { topScorers } from "./scorers.ts";
import { fmtLineup, fmtStats, postDetails } from "./details.ts";
import { fallbackGoals } from "./flashscore.ts";
import { postStandings } from "./standings.ts";
import { eventDetail, eventStats, eventsByDay, lineup } from "./sportsdb.ts";

export async function ratingsNow() {
  const all = await seasonEvents();
  const finished = all.filter(isFinished);
  return { all, table: trainRatings(finished) };
}

const onlyGoals = (tl: TimelineItem[]) =>
  tl.filter((t) => /goal/i.test(t.strTimeline) && !/own|missed|disallow/i.test(t.strTimelineDetail ?? ""));

export async function postDailyMenu(date: string): Promise<void> {
  const { all, table } = await ratingsNow();
  const today = all.filter((e) => e.dateEvent === date);
  const preds = new Map(today.map((e) => [e.idEvent, predictMatch(table, e.strHomeTeam, e.strAwayTeam)]));
  const recent = all.filter(isFinished)
    .sort((a, b) => (b.strTimestamp ?? "").localeCompare(a.strTimestamp ?? ""));
  const teams = [...new Set(all.flatMap((e) => [e.strHomeTeam, e.strAwayTeam]))];
  const champ = championForecast(table, teams);
  await sendMessage(fmtDailyMenu(date, today, preds, recent, champ, await topScorers()));
  await postStandings();
}

export async function postPrematch(e: WcEvent): Promise<void> {
  const { table } = await ratingsNow();
  const ev = (await eventDetail(e.idEvent)) ?? e;
  await sendMessage(fmtPrematch(ev, predictMatch(table, ev.strHomeTeam, ev.strAwayTeam)));
}

async function announceGoal(e: WcEvent, g: TimelineItem, score: string): Promise<void> {
  const pl = g.strPlayer ? await findPlayer(g.strPlayer) : null;
  const caption = fmtGoalCaption(g, e, pl, score);
  const img = pl?.strCutout || pl?.strThumb;
  if (img) await sendPhoto(img, caption);
  else await sendMessage(caption);
}

export async function postFulltime(e: WcEvent): Promise<void> {
  const { table } = await ratingsNow();
  const ev = (await eventDetail(e.idEvent)) ?? e;
  const pred = predictMatch(table, ev.strHomeTeam, ev.strAwayTeam);
  let goals = onlyGoals(await timeline(ev.idEvent));
  if (!goals.length) goals = await fallbackGoals(ev);
  await sendMessage(fmtFulltime(ev, pred, goals));
  await postDetails(ev);
}

const utcDay = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Merge season feed with today's/yesterday's day feed (which carries live
 *  status) so in-progress matches are tracked even before they hit the season feed. */
async function trackedEvents(): Promise<WcEvent[]> {
  const [season, today, yest] = await Promise.all([
    seasonEvents(), eventsByDay(utcDay(0)), eventsByDay(utcDay(-1)),
  ]);
  const map = new Map<string, WcEvent>();
  for (const e of season) map.set(e.idEvent, e);
  for (const e of [...yest, ...today]) map.set(e.idEvent, e); // day feed wins (live status)
  return [...map.values()];
}

/** Announce any goals in the timeline not yet posted. Runs for live AND
 *  finished matches so late goals the API only publishes at full-time are
 *  not lost when the match flips FT between polls. */
async function catchUpGoals(e: WcEvent, state: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const ev = (await eventDetail(e.idEvent)) ?? e;
  let goals = onlyGoals(await timeline(e.idEvent))
    .sort((a, b) => Number(a.intTime) - Number(b.intTime));
  if (!goals.length) goals = await fallbackGoals(ev); // free key: no timeline → Flashscore
  if (goals.length) {
    let h = 0, a = 0;
    for (const g of goals) {
      const home = g.strHome === "yes" || g.strTeam === e.strHomeTeam;
      if (home) h++; else a++;
      const key = goalKey(e.idEvent, g.intTime, g.strPlayer);
      if (!state.postedGoals.includes(key)) {
        await announceGoal(ev, g, `${h} x ${a}`);
        state.postedGoals.push(key);
      }
    }
    return;
  }
  await catchUpFromScore(ev, state); // free key: no timeline → derive from score
}

/** Fallback when the timeline feed is empty: announce one alert per goal
 *  inferred from the score delta. Scorer/order unknown — home goals first. */
async function catchUpFromScore(e: WcEvent, state: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const sh = Number(e.intHomeScore), sa = Number(e.intAwayScore);
  if (!Number.isFinite(sh) || !Number.isFinite(sa)) return;
  let h = 0, a = 0;
  const fire = async (team: string, side: "H" | "A", n: number) => {
    const key = `${e.idEvent}:score:${side}${n}`;
    if (state.postedGoals.includes(key)) return;
    await sendMessage(fmtScoreGoal(e, team, `${h} x ${a}`));
    state.postedGoals.push(key);
  };
  for (let n = 1; n <= sh; n++) { h++; await fire(e.strHomeTeam, "H", n); }
  for (let n = 1; n <= sa; n++) { a++; await fire(e.strAwayTeam, "A", n); }
}

/** One polling pass over live matches: prematch, goals, full-time. */
export async function pollOnce(): Promise<number> {
  const state = await loadState();
  const all = await trackedEvents();
  let live = 0;

  for (const e of all) {
    if (isLive(e)) {
      live++;
      if (!state.prematchPosted.includes(e.idEvent)) {
        await postPrematch(e);
        state.prematchPosted.push(e.idEvent);
      }
      await catchUpGoals(e, state);
    }
    if (isFinished(e) && !state.fulltimePosted.includes(e.idEvent)) {
      if (state.prematchPosted.includes(e.idEvent)) {
        await catchUpGoals(e, state); // flush late goals before the FT summary
        await postFulltime(e);
        state.fulltimePosted.push(e.idEvent);
      }
    }
  }
  await saveState(state);
  return live;
}

export async function trackForever(): Promise<void> {
  console.log(`Tracking WC live every ${config.pollIntervalSec}s…`);
  for (;;) {
    try {
      const live = await pollOnce();
      console.log(`[${new Date().toISOString()}] live=${live}`);
    } catch (err) {
      console.error("poll error:", (err as Error).message);
    }
    await Bun.sleep(config.pollIntervalSec * 1000);
  }
}

/** Homologation: replay a past date as if it happened live, end-to-end. */
export async function replayDate(date: string): Promise<void> {
  const { table } = await ratingsNow();
  const events = await eventsOnDate(date);
  if (!events.length) { console.log(`No events on ${date}`); return; }

  await postDailyMenu(date);
  await Bun.sleep(1200);

  for (const base of events) {
    const e = (await eventDetail(base.idEvent)) ?? base;
    const pred = predictMatch(table, e.strHomeTeam, e.strAwayTeam);
    await sendMessage(fmtPrematch(e, pred));
    await Bun.sleep(1200);

    const xi = fmtLineup(e, await lineup(e.idEvent));
    if (xi) { await sendMessage(xi); await Bun.sleep(1200); }

    let goals = onlyGoals(await timeline(e.idEvent))
      .sort((a, b) => Number(a.intTime) - Number(b.intTime));
    if (!goals.length) goals = await fallbackGoals(e);
    let h = 0, a = 0;
    for (const g of goals) {
      const home = g.strHome === "yes" || g.strTeam === e.strHomeTeam;
      if (home) h++; else a++;
      await announceGoal(e, g, `${h} x ${a}`);
      await Bun.sleep(1200);
    }
    if (outcomeOf(e)) {
      await sendMessage(fmtFulltime(e, pred, goals));
      await Bun.sleep(1200);
      const st = fmtStats(e, await eventStats(e.idEvent));
      if (st) { await sendMessage(st); await Bun.sleep(1200); }
    }
  }
}
