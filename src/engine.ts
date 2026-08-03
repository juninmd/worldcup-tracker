import type { Prediction, WcEvent, TimelineItem } from "./types.ts";
import { eventsOnDate, findPlayer, findPlayerById, isFinished, isLive, mergedSeasonEvents, seasonEvents, timeline, substitutionEvents, varIncidents, cardEvents } from "./sportsdb.ts";
import { trainRatings, outcomeOf } from "./elo.ts";
import { calibrateGoals, predictMatch } from "./predict.ts";
import { bracketAwareChampionForecast, championForecast } from "./champion.ts";
import { fmtBrazilFriendlies, fmtDailyMenu, fmtFulltime, fmtGoalCaption, fmtPrematch, flag, kickoff, nextWorldCupLine, parseUtc } from "./format.ts";
import { sendMediaGroup, sendMessage, sendPhoto, sendPhotoStrict } from "./telegram.ts";
import { loadState, saveState } from "./state.ts";
import { config } from "./config.ts";
import { topScorers } from "./scorers.ts";
import { postTopCards } from "./cards.ts";
import { postVenues } from "./venues.ts";
import { postGoalTimes } from "./goaltimes.ts";
import { postStreaks } from "./streaks.ts";
import { postConfederations } from "./confederations.ts";
import { postTournamentInfo } from "./tourneyinfo.ts";
import { fmtLineup, fmtStats, postDetails } from "./details.ts";
import { postMatchAnalysis } from "./analysis.ts";
import { buildStarterHistory, lineupPenalty, missingKeyPlayers, squadAbsencePenalties } from "./injuries.ts";
import { canonicalTeam } from "./elo.ts";
import { postStandings } from "./standings.ts";
import { eventDetail, eventStats, eventsByDay, lineup } from "./sportsdb.ts";
import { writeFile } from "node:fs/promises";
import { fmtTournamentProjection, fmtTournamentSurprises, tournamentProjection } from "./tournament.ts";
import { fmtSimulation, simulateKnockout } from "./simulate.ts";
import { brazilMetrics, brazilNegativeIncidents, fmtBrazilMetrics } from "./brazil.ts";
import { brazilFixtures } from "./sportsdb.ts";
import { postCycle2030 } from "./cycle2030.ts";
import { finishedCycleEvents } from "./cycle.ts";
import { fmtFotmobEval, fotmobEval, fotmobPerformanceLines } from "./fotmob.ts";
import { type BrazilPostMortemInput, brazilPostMortem, fmtBrazilPostMortem, fmtMatchPreview, postBracketOracle, previewMatch } from "./oracle.ts";
import {
  championChartUrl,
  formChartUrl,
  matchOddsChartUrl,
  simulationChartUrl,
  strengthChartUrl,
  tournamentCircleChartUrl,
  tournamentFlameChartUrl,
  type FixtureOdds,
  type TeamForm,
} from "./charts.ts";
import type { ChampionOdds } from "./champion.ts";
import { predictionFromSnapshot, predictionSnapshot, recordOperationalEvent, savePredictionSnapshot, settlePredictionSnapshot } from "./db.ts";

const HEARTBEAT = new URL("../data/heartbeat", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export async function ratingsNow() {
  const all = await mergedSeasonEvents();
  const finished = all.filter(isFinished);
  // Goal calibration stays on World Cup matches only: qualifiers and friendlies
  // score at a different rate and would drag the tournament's scoreline model.
  calibrateGoals(finished);
  // Ratings, on the other hand, must keep moving through the 2030 cycle — the
  // 2026 feed is frozen at the final. Best-effort: a flaky calendar degrades to
  // the World Cup table instead of breaking every prediction.
  const cycle = await finishedCycleEvents().catch(() => [] as WcEvent[]);
  return { all, table: trainRatings([...finished, ...cycle]) };
}

const onlyGoals = (tl: TimelineItem[]) =>
  tl.filter((t) => /goal/i.test(t.strTimeline) && !/missed|disallow/i.test(t.strTimelineDetail ?? ""));

export async function postDailyMenu(date: string): Promise<void> {
  // The World Cup runs every 4 years: once the final is a real result, every
  // match-day broadcast below (cover, champion odds, projected bracket, charts,
  // and the 9 bonus sections) is stale and just spams the channel about a Cup
  // that already ended. Short-circuit to a lightweight countdown + Seleção agenda.
  const projection = await tournamentProjection();
  const finalRound = projection.knockout.at(-1);
  const tournamentOver = finalRound?.[0]?.round === "Final" && !!finalRound[0]?.real;
  if (tournamentOver) {
    await postPostTournamentDigest();
    return;
  }
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
  const pens = await squadAbsencePenalties(all).catch(() => new Map<string, number>());
  const preds = new Map(today.map((e) => [e.idEvent, predictMatch(table, e.strHomeTeam, e.strAwayTeam, all, true, {
    home: pens.get(canonicalTeam(e.strHomeTeam)) ?? 0,
    away: pens.get(canonicalTeam(e.strAwayTeam)) ?? 0,
  })]));
  for (const event of today.filter((event) => !isFinished(event))) {
    const prediction = preds.get(event.idEvent);
    if (prediction) savePredictionSnapshot(event, prediction, "daily_menu");
  }
  const recent = all.filter(isFinished)
    .sort((a, b) => (b.strTimestamp ?? "").localeCompare(a.strTimestamp ?? ""));
  const teams = [...new Set(all.flatMap((e) => [e.strHomeTeam, e.strAwayTeam]))];
  const simulation = simulateKnockout(projection, table, all);
  const champ = bracketAwareChampionForecast(championForecast(table, teams), simulation?.title ?? null);
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
  // The Seleção's upcoming friendlies (kept following even mid-Cup). The
  // countdown to the next World Cup lives in the post-tournament digest, which
  // fully replaces this menu once the final is decided (see the guard above).
  const now = Date.now();
  const friendlies = await brazilFixtures(
    new Date(now - 30 * 86_400_000).toISOString(),
    new Date(now + 400 * 86_400_000).toISOString(),
  ).then((events) => fmtBrazilFriendlies(events)).catch(() => null);
  await sendMessage(fmtDailyMenu(date, today, preds, recent, champ, await topScorers(), projection.brazilPath, [friendlies]));

  // Each of these is a self-contained "bonus" broadcast — a transient failure in
  // one (a flaky fetch, a Telegram hiccup) must not swallow the rest of the menu.
  const sections: [string, () => Promise<unknown>][] = [
    ["standings", () => postStandings()],
    ["analysis charts", () => postAnalysisCharts(champ, all, today, preds)],
    ["tournament projection", () => postTournamentProjection(projection)],
    ["cards", () => postTopCards()],
    ["venues", () => postVenues()],
    ["goal times", () => postGoalTimes()],
    ["streaks", () => postStreaks()],
    ["confederations", () => postConfederations()],
    ["tournament info", () => postTournamentInfo()],
  ];
  for (const [label, run] of sections) {
    try {
      await run();
    } catch (err) {
      console.error(`daily menu section "${label}" failed:`, (err as Error).message);
    }
  }
}

/** Once the Cup is decided there's nothing to preview — it only runs every 4
 *  years. Keep a lightweight daily touch: the countdown to the next World Cup
 *  plus the Seleção's agenda (friendlies/other games) when there's something on,
 *  then the 2030 cycle briefing (roadmap + how the 2026 squad ages into it). */
async function postPostTournamentDigest(): Promise<void> {
  const now = Date.now();
  const friendlies = await brazilFixtures(
    new Date(now - 30 * 86_400_000).toISOString(),
    new Date(now + 400 * 86_400_000).toISOString(),
  ).then((events) => fmtBrazilFriendlies(events)).catch(() => null);
  await sendMessage([nextWorldCupLine(), friendlies].filter(Boolean).join("\n\n"));
  try {
    await postCycle2030();
  } catch (err) {
    console.error("2030 cycle briefing failed:", (err as Error).message);
  }
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
  const circle = tournamentCircleChartUrl(projection);
  if (circle) await sendPhoto(circle, `⭕ Chaveamento em círculos — Copa 2026 · campeão previsto: ${projection.champion}`);
  const chart = tournamentFlameChartUrl(projection);
  if (chart) await sendPhoto(chart, `🔥 Chama da Copa 2026 — campeão previsto: ${projection.champion}`);
  await sendMessage(fmtTournamentProjection(projection));

  // Who over/under-performed vs their FIFA seed (silent until the KO is decided).
  const surprises = fmtTournamentSurprises(projection);
  if (surprises) await sendMessage(surprises);

  // Brazil eliminated → data-grounded post-mortem (best-effort: LLM may be down).
  await postBrazilPostMortem(projection).catch((err) =>
    console.error("brazil post-mortem failed:", (err as Error).message));

  const { all, table } = await ratingsNow();
  const sim = simulateKnockout(projection, table, all);
  if (sim) {
    const simChart = simulationChartUrl(sim.title, sim.runs);
    if (simChart) await sendPhoto(simChart, `🎲 Monte Carlo — chances reais de título pelo chaveamento`);
    await sendMessage(fmtSimulation(sim));
    // LLM read of the bracket — best-effort: gateway may be down/slow.
    await postBracketOracle(projection, sim).catch((err) =>
      console.error("bracket oracle failed:", (err as Error).message));
  }
}

/** Post-match autopsy of Brazil's campaign, posted once the Seleção is eliminated.
 *  Numbers come from real FIFA-derived metrics; the LLM only narrates them. */
async function postBrazilPostMortem(projection: Awaited<ReturnType<typeof tournamentProjection>>): Promise<void> {
  const last = projection.brazilPath.at(-1);
  if (!last || !last.real || canonicalTeam(last.winner) === "Brazil") return; // still alive / no data
  const metrics = await brazilMetrics();
  if (!metrics.played) return;
  const isHome = canonicalTeam(last.home) === "Brazil";
  const opponent = isHome ? last.away : last.home;
  const bGoals = isHome ? last.prediction.homeGoals : last.prediction.awayGoals;
  const oGoals = isHome ? last.prediction.awayGoals : last.prediction.homeGoals;

  // Real per-player ratings + wrong passes for the elimination match (FotMob/Opta) —
  // lets us evaluate the game and name who dropped off, on real numbers.
  const oppCanon = canonicalTeam(opponent);
  const elimEvent = (await mergedSeasonEvents()).filter(isFinished).find((e) => {
    const h = canonicalTeam(e.strHomeTeam), a = canonicalTeam(e.strAwayTeam);
    return (h === "Brazil" && a === oppCanon) || (a === "Brazil" && h === oppCanon);
  });
  const fmEval = elimEvent ? await fotmobEval(elimEvent.dateEvent, "Brazil", opponent).catch(() => null) : null;
  if (fmEval) await sendMessage(fmtFotmobEval(fmEval));

  const input: BrazilPostMortemInput = {
    eliminatedRound: last.round,
    eliminationScore: `${flag("Brazil")} Brasil ${bGoals}×${oGoals} ${opponent} ${flag(opponent)}`,
    opponent,
    metricsSummary: fmtBrazilMetrics(metrics).split("\n").slice(1),
    incidentsReais: await brazilNegativeIncidents(),
    desempenho: fmEval ? fotmobPerformanceLines(fmEval) : [],
  };
  await sendMessage(fmtBrazilPostMortem(input, await brazilPostMortem(input)));
}

/** Best available event artwork to use as a visual cover. */
const eventCover = (e: WcEvent): string | null =>
  e.strThumb || e.strPoster || e.strFanart || e.strBanner || null;

export async function postPrematch(e: WcEvent): Promise<void> {
  const { all, table } = await ratingsNow();
  const ev = (await eventDetail(e.idEvent)) ?? e;
  const xi = await lineup(ev.idEvent);
  const history = await buildStarterHistory(all);
  const absences = {
    home: missingKeyPlayers(xi, ev.strHomeTeam, true, history),
    away: missingKeyPlayers(xi, ev.strAwayTeam, false, history),
  };
  const pen = {
    home: lineupPenalty(xi, ev.strHomeTeam, true, history),
    away: lineupPenalty(xi, ev.strAwayTeam, false, history),
  };
  // Rich card: event artwork + both team crests as one album.
  const art = [eventCover(ev), ev.strHomeTeamBadge, ev.strAwayTeamBadge].filter((x): x is string => !!x);
  const caption = `⚽️ ${ev.strHomeTeam} x ${ev.strAwayTeam}`;
  if (art.length) await sendMediaGroup(art, caption);
  const pred = predictMatch(table, ev.strHomeTeam, ev.strAwayTeam, all, true, pen);
  savePredictionSnapshot(ev, pred, "prematch");
  await sendMessage(fmtPrematch(ev, pred, absences));
  // Qualitative LLM take on the fixture — best-effort.
  try {
    await sendMessage(fmtMatchPreview(ev, await previewMatch(ev, pred, absences)));
  } catch (err) {
    console.error("match preview failed:", (err as Error).message);
  }
}

async function announceGoal(e: WcEvent, g: TimelineItem, score: string): Promise<boolean> {
  const pl = g.idPlayer ? await findPlayerById(g.idPlayer) : g.strPlayer ? await findPlayer(g.strPlayer) : null;
  const img = pl?.strCutout || pl?.strThumb;
  if (!img) return false;
  await sendPhotoStrict(img, fmtGoalCaption(g, e, pl, score));
  return true;
}

export async function postFulltime(e: WcEvent, state?: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const all = await mergedSeasonEvents();
  const ev = (await eventDetail(e.idEvent)) ?? e;
  const snapshot = predictionSnapshot(ev.idEvent);
  const prior = all.filter((candidate) => isFinished(candidate) && candidate.idEvent !== ev.idEvent &&
    (candidate.strTimestamp ?? candidate.dateEvent) < (ev.strTimestamp ?? ev.dateEvent));
  if (!snapshot) calibrateGoals(prior);
  const pred = snapshot
    ? predictionFromSnapshot(snapshot)
    : predictMatch(trainRatings(prior), ev.strHomeTeam, ev.strAwayTeam, prior);
  settlePredictionSnapshot(ev);
  let goals = onlyGoals(await timeline(ev.idEvent));
  await sendMessage(fmtFulltime(ev, pred, goals));
  await postDetails(ev);

  // Post-match AI post-mortem for EVERY finished match (dedup per event, best-effort:
  // the LLM gateway may be down/slow and must never block the full-time flow).
  if (state && !state.postedAnalysis.includes(ev.idEvent)) {
    try {
      await postMatchAnalysis(ev);
    } catch (err) {
      console.error("match analysis failed:", (err as Error).message);
    }
    state.postedAnalysis.push(ev.idEvent);
    await saveState(state);
  }
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

/** Announce official FIFA timeline goals not yet posted.
 *  The score feed can move before FIFA publishes the scorer, but Telegram must
 *  not emit anonymous/partial goal alerts. */
async function catchUpGoals(e: WcEvent, state: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const ev = (await eventDetail(e.idEvent)) ?? e;
  let goals = onlyGoals(await timeline(e.idEvent))
    .sort((a, b) => Number(a.intTime) - Number(b.intTime));

  const isHome = (g: TimelineItem) => g.strHome === "yes" || g.strTeam === ev.strHomeTeam;
  let h = 0, a = 0, hi = 0, ai = 0;
  const post = async (side: "H" | "A", body: () => Promise<boolean>) => {
    const ord = side === "H" ? ++hi : ++ai;
    const key = `${ev.idEvent}:${side}:${ord}`;
    if (state.postedGoals.includes(key)) return;
    if (await body()) {
      state.postedGoals.push(key);
      // Persist right after the send, not just at the end of pollOnce() — a
      // crash mid-cycle (OOMKill, etc.) must not lose this dedup key and
      // cause the goal to be re-announced on the next poll.
      await saveState(state);
    }
  };

  for (const g of goals) { // known scorers, progressively by minute
    const home = isHome(g);
    if (home) h++; else a++;
    await post(home ? "H" : "A", () => announceGoal(ev, g, `${h} x ${a}`));
  }
}

/** Announce substitutions and VAR reviews as they land in the FIFA timeline,
 *  so the channel gets them in-game instead of only in the post-match digest. */
async function catchUpMatchEvents(e: WcEvent, state: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const [subs, vr] = await Promise.all([substitutionEvents(e.idEvent), varIncidents(e.idEvent)]);
  for (const s of subs) {
    const key = `${e.idEvent}:${s.minute}:${s.playerIn}`;
    if (state.postedSubs.includes(key)) continue;
    await sendMessage(`🔄 *Substituição* — ${flag(s.team ?? "")} ${s.team}\n${s.minute}' ${s.playerIn} 🔼 entra no lugar de 🔽 ${s.playerOut}`);
    state.postedSubs.push(key);
    await saveState(state);
  }
  for (const v of vr) {
    const key = `${e.idEvent}:${v.minute}`;
    if (state.postedVar.includes(key)) continue;
    const teamLabel = v.team ? `${flag(v.team)} ${v.team}` : `${e.strHomeTeam} x ${e.strAwayTeam}`;
    const lines = [`🖥 *VAR* — ${teamLabel}`, `${v.minute}' ${v.comment ?? "Revisão do VAR"}`];
    if (v.outcome) lines.push(`➡️ ${v.outcome}`);
    await sendMessage(lines.join("\n"));
    state.postedVar.push(key);
    await saveState(state);
  }
}

/** Announce yellow/red cards as they land in the FIFA timeline — a card (esp. a
 *  red) is often the single biggest explanation for a zebra result, so it must
 *  reach the channel live instead of only surfacing in the post-match digest. */
async function catchUpCards(e: WcEvent, state: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const cards = await cardEvents(e.idEvent);
  for (const c of cards) {
    const key = `${e.idEvent}:${c.idTimeline ?? `${c.intTime}:${c.strPlayer}:${c.cardType}`}`;
    if (state.postedCards.includes(key)) continue;
    const icon = c.cardType === "red" ? "🟥" : "🟨";
    const label = c.cardType === "red" ? "Cartão vermelho" : "Cartão amarelo";
    await sendMessage(`${icon} *${label}* — ${flag(c.strTeam ?? "")} ${c.strTeam ?? ""}\n${c.intTime}' ${c.strPlayer ?? "?"}`);
    state.postedCards.push(key);
    await saveState(state);
  }
}

const UPCOMING_ALERT_WINDOW_MIN = 30;

/** Heads-up ~30min before kickoff for any match not yet live, so people know
 *  what's coming next — distinct from postPrematch, which only fires once the
 *  match actually goes live (score/status become available on the feed). */
async function checkUpcomingAlerts(all: WcEvent[], state: Awaited<ReturnType<typeof loadState>>): Promise<void> {
  const now = Date.now();
  for (const e of all) {
    if (isLive(e) || isFinished(e)) continue;
    if (state.postedUpcomingAlert.includes(e.idEvent)) continue;
    const kick = parseUtc(e.strTimestamp);
    if (!kick) continue;
    const minutesUntil = (kick.getTime() - now) / 60_000;
    if (minutesUntil <= 0 || minutesUntil > UPCOMING_ALERT_WINDOW_MIN) continue;

    await sendMessage([
      `⏰ *Próximo jogo em ${Math.max(1, Math.round(minutesUntil))} min!*`,
      `${flag(e.strHomeTeam)} *${e.strHomeTeam} x ${e.strAwayTeam}* ${flag(e.strAwayTeam)}`,
      `🕒 ${kickoff(e)}`,
      [e.strStage, e.strGroup].filter(Boolean).join(" · "),
      e.strVenue ? `🏟 ${e.strVenue}${e.strCity ? ` — ${e.strCity}` : ""}` : "",
    ].filter(Boolean).join("\n"));
    state.postedUpcomingAlert.push(e.idEvent);
    await saveState(state);
  }
}

/** One polling pass over live matches: prematch, goals, full-time. */
export async function pollOnce(): Promise<number> {
  const state = await loadState();
  const all = await trackedEvents();
  let live = 0;

  await checkUpcomingAlerts(all, state);

  for (const e of all) {
    if (isLive(e)) {
      live++;
      if (!state.prematchPosted.includes(e.idEvent)) {
        await postPrematch(e);
        state.prematchPosted.push(e.idEvent);
        await saveState(state);
      }
      await catchUpGoals(e, state);
      await catchUpMatchEvents(e, state);
      await catchUpCards(e, state);
    }
    if (isFinished(e) && !state.fulltimePosted.includes(e.idEvent)) {
      if (state.prematchPosted.includes(e.idEvent)) {
        await catchUpGoals(e, state); // flush late goals before the FT summary
        await catchUpCards(e, state); // flush any card issued in the closing minutes
        await postFulltime(e, state);
        state.fulltimePosted.push(e.idEvent);
        await saveState(state);
      }
    }
  }
  return live;
}

export async function trackForever(): Promise<void> {
  console.log(`Tracking WC: idle every ${config.pollIntervalSec}s, live every ${config.livePollIntervalSec}s…`);
  let prevLive = -1;
  for (;;) {
    let live = 0;
    const started = Date.now();
    try {
      live = await pollOnce();
      recordOperationalEvent({ subsystem: "poll", operation: live > 0 ? "live" : "idle", outcome: "ok", latencyMs: Date.now() - started });
      // Log only when the live-match count changes — a per-tick heartbeat floods
      // ~5.8k lines/day and buries real errors. The heartbeat file below already
      // proves liveness for the k8s probe.
      if (live !== prevLive) {
        console.log(`[${new Date().toISOString()}] live=${live}`);
        prevLive = live;
      }
    } catch (err) {
      recordOperationalEvent({ subsystem: "poll", operation: "cycle", outcome: "error", latencyMs: Date.now() - started });
      console.error("poll error:", (err as Error).message);
    }
    // Liveness heartbeat: a healthy loop refreshes this file every pass; the
    // k8s livenessProbe restarts the pod if it goes stale (hung fetch/deadlock).
    await writeFile(HEARTBEAT, new Date().toISOString()).catch(() => {});
    // Adaptive cadence: poll faster while a match is live (fresher goals/cards/VAR),
    // slower while idle — this keeps total FIFA request volume in check instead of
    // polling at the fast rate around the clock.
    await Bun.sleep((live > 0 ? config.livePollIntervalSec : config.pollIntervalSec) * 1000);
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
    let h = 0, a = 0;
    for (const g of goals) {
      const home = g.strHome === "yes" || g.strTeam === e.strHomeTeam;
      if (home) h++; else a++;
      if (await announceGoal(e, g, `${h} x ${a}`)) await Bun.sleep(1200);
    }
    if (outcomeOf(e)) {
      await sendMessage(fmtFulltime(e, pred, goals));
      await Bun.sleep(1200);
      const st = fmtStats(e, await eventStats(e.idEvent));
      if (st) { await sendMessage(st); await Bun.sleep(1200); }
    }
  }
}
