import type { Prediction, WcEvent, TimelineItem } from "./types.ts";
import { eventsOnDate, findPlayer, isFinished, isLive, mergedSeasonEvents, seasonEvents, timeline } from "./sportsdb.ts";
import { trainRatings, outcomeOf } from "./elo.ts";
import { predictMatch } from "./predict.ts";
import { championForecast } from "./champion.ts";
import { fmtDailyMenu, fmtFulltime, fmtGoalCaption, fmtPrematch, fmtScoreGoal } from "./format.ts";
import { sendMediaGroup, sendMessage, sendPhoto } from "./telegram.ts";
import { loadState, saveState } from "./state.ts";
import { config } from "./config.ts";
import { topScorers } from "./scorers.ts";
import { fmtLineup, fmtStats, postDetails } from "./details.ts";
import { lineupPenalty, missingKeyPlayers } from "./injuries.ts";
import { fallbackGoals } from "./flashscore.ts";
import { postStandings } from "./standings.ts";
import { eventDetail, eventStats, eventsByDay, lineup } from "./sportsdb.ts";
import { writeFile } from "node:fs/promises";
import { fmtTournamentProjection, tournamentProjection } from "./tournament.ts";
import {
  championChartUrl,
  formChartUrl,
  matchOddsChartUrl,
  strengthChartUrl,
  tournamentFlameChartUrl,
  type FixtureOdds,
  type TeamForm,
} from "./charts.ts";
import type { ChampionOdds } from "./champion.ts";

const HEARTBEAT = new URL("../data/heartbeat", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export async function ratingsNow() {
  const all = await mergedSeasonEvents();
  const finished = all.filter(isFinished);
  return { all, table: trainRatings(finished) };
}

const onlyGoals = (tl: TimelineItem[]) =>
  tl.filter((t) => /goal/i.test(t.strTimeline) && !/own|missed|disallow/i.test(t.strTimelineDetail ?? ""));

export async function postDailyMenu(date: string): Promise<void> {
  const { all, table } = await ratingsNow();
  // The free-tier season feed lags the real schedule (often days behind), so the
  // day feed is the source of truth for "what's on today" — it also carries live
  // status and event artwork. Merge both, day feed winning on conflicts.
  const dayFeed = await eventsByDay(date);
  const todayMap = new Map<string, WcEvent>();
  for (const e of all.filter((e) => e.dateEvent === date)) todayMap.set(e.idEvent, e);
  for (const e of dayFeed) todayMap.set(e.idEvent, e);
  const today = [...todayMap.values()]
    .sort((a, b) => (a.strTimestamp ?? "").localeCompare(b.strTimestamp ?? ""));
  const preds = new Map(today.map((e) => [e.idEvent, predictMatch(table, e.strHomeTeam, e.strAwayTeam, all)]));
  const recent = all.filter(isFinished)
    .sort((a, b) => (b.strTimestamp ?? "").localeCompare(a.strTimestamp ?? ""));
  const teams = [...new Set(all.flatMap((e) => [e.strHomeTeam, e.strAwayTeam]))];
  const champ = championForecast(table, teams);
  // Headline an actual game still to come today, not one that already finished
  // (the day feed lists late-night fixtures under the next calendar day).
  const upcoming = today.filter((e) => !isFinished(e));
  const headline = (upcoming[0] ?? today[0]) as WcEvent | undefined;
  const cover = upcoming.map(eventCover).find(Boolean) ?? today.map(eventCover).find(Boolean);
  if (cover) {
    const caption = headline
      ? `⚽️ Hoje: ${headline.strHomeTeam} x ${headline.strAwayTeam} — ${date}`
      : `📅 Jogos de hoje — ${date}`;
    await sendPhoto(cover, caption);
  }
  const projection = await tournamentProjection();
  await sendMessage(fmtDailyMenu(date, today, preds, recent, champ, await topScorers(), projection.brazilPath));
  await postStandings();
  await postAnalysisCharts(champ, all, today, preds);
  await postTournamentProjection(projection);
}

/** Last-N results per team (most recent first), from finished matches. */
function recentForm(finished: WcEvent[], limit = 5): TeamForm[] {
  const byTeam = new Map<string, ("W" | "D" | "L")[]>();
  const sorted = [...finished].sort((a, b) =>
    (b.strTimestamp ?? b.dateEvent).localeCompare(a.strTimestamp ?? a.dateEvent),
  );
  const push = (team: string, res: "W" | "D" | "L") => {
    const arr = byTeam.get(team) ?? byTeam.set(team, []).get(team)!;
    if (arr.length < limit) arr.push(res);
  };
  for (const e of sorted) {
    const o = outcomeOf(e);
    if (!o) continue;
    push(e.strHomeTeam, o.result === "H" ? "W" : o.result === "D" ? "D" : "L");
    push(e.strAwayTeam, o.result === "A" ? "W" : o.result === "D" ? "D" : "L");
  }
  return [...byTeam.entries()].map(([team, results]) => ({ team, results }));
}

/** Shareable analysis cards: title odds, team strength, recent form, today's 1X2. */
async function postAnalysisCharts(
  champ: ChampionOdds[],
  all: WcEvent[],
  today: WcEvent[],
  preds: Map<string, Prediction>,
): Promise<void> {
  const champChart = championChartUrl(champ);
  if (champChart) await sendPhoto(champChart, "🏆 Favoritas ao título — Copa do Mundo 2026");

  const strengthChart = strengthChartUrl(champ);
  if (strengthChart) await sendPhoto(strengthChart, "💪 Força das seleções (Elo + elenco)");

  const formChart = formChartUrl(recentForm(all.filter(isFinished)));
  if (formChart) await sendPhoto(formChart, "📈 Forma recente das seleções");

  const fixtures: FixtureOdds[] = today
    .filter((e) => !isFinished(e))
    .map((e) => {
      const p = preds.get(e.idEvent);
      return p && { label: `${e.strHomeTeam} x ${e.strAwayTeam}`, pHome: p.pHome, pDraw: p.pDraw, pAway: p.pAway };
    })
    .filter((x): x is FixtureOdds => !!x);
  const oddsChart = matchOddsChartUrl(fixtures);
  if (oddsChart) await sendPhoto(oddsChart, "🎲 Probabilidades dos jogos de hoje");
}

export async function postTournamentProjection(pre?: Awaited<ReturnType<typeof tournamentProjection>>): Promise<void> {
  const projection = pre ?? await tournamentProjection();
  const chart = tournamentFlameChartUrl(projection);
  if (chart) await sendPhoto(chart, `🔥 Chama da Copa 2026 — campeão previsto: ${projection.champion}`);
  await sendMessage(fmtTournamentProjection(projection));
}

/** Best available event artwork to use as a visual cover. */
const eventCover = (e: WcEvent): string | null =>
  e.strThumb || e.strPoster || e.strFanart || e.strBanner || null;

export async function postPrematch(e: WcEvent): Promise<void> {
  const { all, table } = await ratingsNow();
  const ev = (await eventDetail(e.idEvent)) ?? e;
  const xi = await lineup(ev.idEvent);
  const absences = {
    home: missingKeyPlayers(xi, ev.strHomeTeam, true),
    away: missingKeyPlayers(xi, ev.strAwayTeam, false),
  };
  const pen = {
    home: lineupPenalty(xi, ev.strHomeTeam, true),
    away: lineupPenalty(xi, ev.strAwayTeam, false),
  };
  // Rich card: event artwork + both team crests as one album.
  const art = [eventCover(ev), ev.strHomeTeamBadge, ev.strAwayTeamBadge].filter((x): x is string => !!x);
  const caption = `⚽️ ${ev.strHomeTeam} x ${ev.strAwayTeam}`;
  if (art.length) await sendMediaGroup(art, caption);
  await sendMessage(fmtPrematch(ev, predictMatch(table, ev.strHomeTeam, ev.strAwayTeam, all, true, pen), absences));
}

async function announceGoal(e: WcEvent, g: TimelineItem, score: string): Promise<void> {
  const pl = g.strPlayer ? await findPlayer(g.strPlayer) : null;
  const caption = fmtGoalCaption(g, e, pl, score);
  const img = pl?.strCutout || pl?.strThumb;
  if (img) await sendPhoto(img, caption);
  else await sendMessage(caption);
}

export async function postFulltime(e: WcEvent): Promise<void> {
  const { all, table } = await ratingsNow();
  const ev = (await eventDetail(e.idEvent)) ?? e;
  const pred = predictMatch(table, ev.strHomeTeam, ev.strAwayTeam, all);
  let goals = onlyGoals(await timeline(ev.idEvent));
  if (!goals.length) goals = await fallbackGoals(ev);
  await sendMessage(fmtFulltime(ev, pred, goals));
  await postDetails(ev);
  if (ev.strVideo) await sendMessage(`🎥 *Melhores lances*\n${ev.strVideo}`, true); // preview embeds the clip
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

/** Announce goals not yet posted. Score-driven for real-time guarantee: the
 *  score is the source of truth that a goal happened; the incident feed only
 *  enriches it with the scorer. Goals are keyed by side + ordinal, so a goal
 *  posted from the score is never re-posted when its scorer later publishes.
 *  Runs for live AND finished matches (flushes late goals before full-time). */
async function catchUpGoals(e: WcEvent, state: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const ev = (await eventDetail(e.idEvent)) ?? e;
  let goals = onlyGoals(await timeline(e.idEvent))
    .sort((a, b) => Number(a.intTime) - Number(b.intTime));
  if (!goals.length) goals = await fallbackGoals(ev); // free key: no timeline → Flashscore

  const isHome = (g: TimelineItem) => g.strHome === "yes" || g.strTeam === ev.strHomeTeam;
  const homeInc = goals.filter(isHome).length;
  const awayInc = goals.length - homeInc;
  // Score wins when ahead of the (often lagging) incident feed.
  const sh = Math.max(Number(ev.intHomeScore) || 0, homeInc);
  const sa = Math.max(Number(ev.intAwayScore) || 0, awayInc);

  let h = 0, a = 0, hi = 0, ai = 0;
  const post = async (side: "H" | "A", run: string, body: () => Promise<void>) => {
    const ord = side === "H" ? ++hi : ++ai;
    const key = `${ev.idEvent}:${side}:${ord}`;
    if (state.postedGoals.includes(key)) return;
    await body();
    state.postedGoals.push(key);
  };

  for (const g of goals) { // known scorers, progressively by minute
    const home = isHome(g);
    if (home) h++; else a++;
    await post(home ? "H" : "A", `${h} x ${a}`, () => announceGoal(ev, g, `${h} x ${a}`));
  }
  while (hi < sh) { h++; await post("H", `${h} x ${a}`, () => sendMessage(fmtScoreGoal(ev, ev.strHomeTeam, `${h} x ${a}`))); }
  while (ai < sa) { a++; await post("A", `${h} x ${a}`, () => sendMessage(fmtScoreGoal(ev, ev.strAwayTeam, `${h} x ${a}`))); }
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
    // Liveness heartbeat: a healthy loop refreshes this file every pass; the
    // k8s livenessProbe restarts the pod if it goes stale (hung fetch/deadlock).
    await writeFile(HEARTBEAT, new Date().toISOString()).catch(() => {});
    await Bun.sleep(config.pollIntervalSec * 1000);
  }
}

/** Homologation: replay a past date as if it happened live, end-to-end. */
export async function replayDate(date: string): Promise<void> {
  const { all, table } = await ratingsNow();
  const events = await eventsOnDate(date);
  if (!events.length) { console.log(`No events on ${date}`); return; }

  await postDailyMenu(date);
  await Bun.sleep(1200);

  for (const base of events) {
    const e = (await eventDetail(base.idEvent)) ?? base;
    const pred = predictMatch(table, e.strHomeTeam, e.strAwayTeam, all);
    const cover = eventCover(e);
    if (cover) { await sendPhoto(cover, `⚽️ ${e.strHomeTeam} x ${e.strAwayTeam}`); await Bun.sleep(1200); }
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
      if (e.strVideo) { await sendMessage(`🎥 *Melhores lances*\n${e.strVideo}`, true); await Bun.sleep(1200); }
    }
  }
}
