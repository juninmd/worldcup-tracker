import { tournamentFlameChartUrl } from "./charts.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { tournamentProjection } from "./tournament.ts";
import { eventStats, fifaEndpointHealth, findPlayerById, isFinished, isLive, lineup, mergedSeasonEvents, squadPlayers, timeline, type FifaEndpointHealth } from "./sportsdb.ts";
import { topScorers } from "./scorers.ts";
import { existsSync } from "node:fs";
import { fmtGoalCaption, flag } from "./format.ts";
import type { LineupPlayer, TimelineItem, WcEvent } from "./types.ts";
import { canonicalTeam, fifaRank, trainRatings } from "./elo.ts";
import { simulateKnockout } from "./simulate.ts";
import { buildLeakFreeBacktest, evaluatePredictions } from "./metrics.ts";

export interface HomologationResult {
  groups: number;
  qualifiers: number;
  rounds: number[];
  champion: string;
  bracketSource: "fifa" | "heuristic-fallback" | "unknown";
  titleFinals: number;
  modelMetrics: { matches: number; brier: number | null; logLoss: number | null; calibrationError: number | null };
  chartStatus: number;
  chartContentType: string;
  chartBytes: number;
  problems: string[];
}

export interface FullHomologationResult {
  source: "FIFA";
  matches: number;
  teams: number;
  rosterPlayers: number;
  finishedMatches: number;
  liveMatches: number;
  timelineChecked: number;
  timelineGoals: number;
  statsChecked: number;
  playerStats: {
    scorers: number;
    leader: string | null;
    leaderGoals: number;
  };
  production: {
    dockerfile: boolean;
    deployWorkflow: boolean;
  };
  endpoints: FifaEndpointHealth[];
  liveMedia: {
    match: string | null;
    lineupPlayers: number;
    lineupPlayersWithPhoto: number;
    starters: number;
    goals: number;
    goalsWithPlayerPhoto: number;
  };
  forecast: HomologationResult;
  problems: string[];
}

export interface TelegramDryRunResult {
  match: string | null;
  status: string | null;
  score: string | null;
  lineup: {
    players: number;
    playersWithPhoto: number;
    starters: number;
    mediaGroups: number;
    textChars: number;
  };
  goals: {
    total: number;
    withPlayerPhoto: number;
    alerts: { player: string | null; score: string; photoOk: boolean; captionHasScore: boolean }[];
  };
  mediaChecks: { kind: "lineup" | "goal"; status: number; contentType: string | null }[];
  mediaSummary: {
    checked: number;
    ok: number;
    lineupOk: number;
    goalOk: number;
  };
  problems: string[];
}

function onlyGoals(tl: TimelineItem[]): TimelineItem[] {
  return tl.filter((t) => /goal/i.test(t.strTimeline) && !/missed|disallow/i.test(t.strTimelineDetail ?? ""));
}

function lineupText(e: WcEvent, players: LineupPlayer[]): string {
  const line = (p: LineupPlayer) =>
    `   ${p.intSquadNumber ? `#${p.intSquadNumber} ` : ""}${p.strPlayer}${p.strPosition ? ` _(${p.strPosition})_` : ""}`;
  const side = (home: boolean) => {
    const list = players.filter((p) => ((p.strHome ?? "").toLowerCase() === "yes") === home);
    const xi = list.filter((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
    const subs = list.filter((p) => (p.strSubstitute ?? "").toLowerCase() === "yes");
    return [
      home ? `${flag(e.strHomeTeam)} *${e.strHomeTeam}*` : `${flag(e.strAwayTeam)} *${e.strAwayTeam}*`,
      "  Titulares:",
      ...xi.map(line),
      "  Reservas:",
      ...subs.map(line),
    ];
  };
  return [`📋 *ESCALAÇÕES OFICIAIS FIFA* — ${e.strHomeTeam} x ${e.strAwayTeam}`, "", ...side(true), "", ...side(false)].join("\n");
}

async function checkImage(url: string, kind: "lineup" | "goal"): Promise<{ kind: "lineup" | "goal"; status: number; contentType: string | null }> {
  const res = await fetch(url, { method: "HEAD" }).catch(() => null);
  return { kind, status: res?.status ?? 0, contentType: res?.headers.get("content-type") ?? null };
}

export async function homologateTelegramDryRun(): Promise<TelegramDryRunResult> {
  const problems: string[] = [];
  const events = await mergedSeasonEvents();
  const live = events.filter(isLive);
  const match = live[0] ?? events.filter(isFinished)
    .sort((a, b) => (b.strTimestamp ?? b.dateEvent).localeCompare(a.strTimestamp ?? a.dateEvent))[0] ?? null;
  const players = match ? await lineup(match.idEvent) : [];
  const goals = match ? onlyGoals(await timeline(match.idEvent)).sort((a, b) => Number(a.intTime) - Number(b.intTime)) : [];
  const starters = players.filter((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
  const photos = players.map((p) => p.strThumb).filter((x): x is string => !!x);
  const text = match ? lineupText(match, players) : "";
  const mediaChecks = await Promise.all(photos.map((url) => checkImage(url, "lineup")));

  if (!match) problems.push("no live or finished match available for Telegram dry-run");
  if (match && starters.length !== 22) problems.push(`${match.strEvent} starters ${starters.length} != 22`);
  if (players.length === 0) problems.push("missing complete live lineup");
  if (photos.length !== players.length) problems.push(`lineup photos ${photos.length}/${players.length}`);

  let h = 0, a = 0;
  const alerts: TelegramDryRunResult["goals"]["alerts"] = [];
  for (const goal of goals) {
    const home = goal.strHome === "yes" || goal.strTeam === match?.strHomeTeam;
    if (home) h++; else a++;
    const score = `${h} x ${a}`;
    const player = goal.idPlayer ? await findPlayerById(goal.idPlayer) : null;
    const photo = player?.strCutout || player?.strThumb || null;
    const caption = match ? fmtGoalCaption(goal, match, player, score) : "";
    const check = photo ? await checkImage(photo, "goal") : { kind: "goal" as const, status: 0, contentType: null };
    mediaChecks.push(check);
    alerts.push({
      player: goal.strPlayer,
      score,
      photoOk: check.status >= 200 && check.status < 400 && /image/i.test(check.contentType ?? ""),
      captionHasScore: caption.includes(score),
    });
  }

  const goalPhotoOk = alerts.filter((a) => a.photoOk).length;
  const captionScoreOk = alerts.filter((a) => a.captionHasScore).length;
  if (goalPhotoOk !== goals.length) problems.push(`goal photos ${goalPhotoOk}/${goals.length}`);
  if (captionScoreOk !== goals.length) problems.push(`goal captions with score ${captionScoreOk}/${goals.length}`);
  const badMedia = mediaChecks.filter((c) => !(c.status >= 200 && c.status < 400 && /image/i.test(c.contentType ?? "")));
  if (badMedia.length) problems.push(`bad media URLs: ${badMedia.length}`);

  return {
    match: match?.strEvent ?? null,
    status: match?.strStatus ?? null,
    score: match ? `${match.intHomeScore ?? 0}-${match.intAwayScore ?? 0}` : null,
    lineup: {
      players: players.length,
      playersWithPhoto: photos.length,
      starters: starters.length,
      mediaGroups: Math.ceil(photos.length / 10),
      textChars: text.length,
    },
    goals: {
      total: goals.length,
      withPlayerPhoto: goalPhotoOk,
      alerts,
    },
    mediaSummary: {
      checked: mediaChecks.length,
      ok: mediaChecks.length - badMedia.length,
      lineupOk: mediaChecks.filter((c) => c.kind === "lineup" && c.status >= 200 && c.status < 400 && /image/i.test(c.contentType ?? "")).length,
      goalOk: mediaChecks.filter((c) => c.kind === "goal" && c.status >= 200 && c.status < 400 && /image/i.test(c.contentType ?? "")).length,
    },
    mediaChecks,
    problems,
  };
}

export async function homologateForecast(send = false): Promise<HomologationResult> {
  const projection = await tournamentProjection();
  const events = await mergedSeasonEvents();
  const problems: string[] = [];
  const rounds = projection.knockout.map((r) => r.length);
  const titleFinals = projection.knockout.flat().filter((match) => match.round === "Final").length;
  const metrics = evaluatePredictions(buildLeakFreeBacktest(events));

  if (projection.groups.size !== 12) problems.push(`expected 12 groups, got ${projection.groups.size}`);
  if (projection.qualifiers.length !== 32) problems.push(`expected 32 qualifiers, got ${projection.qualifiers.length}`);
  if (rounds.join(",") !== "16,8,4,2,1") problems.push(`expected knockout 16,8,4,2,1, got ${rounds.join(",")}`);
  if (projection.bracketSource !== "fifa") problems.push(`expected FIFA bracket, got ${projection.bracketSource ?? "unknown"}`);
  if (titleFinals !== 1) problems.push(`expected exactly one title final, got ${titleFinals}`);
  const titleFinal = projection.knockout.flat().find((match) => match.round === "Final");
  if (titleFinal && ![titleFinal.home, titleFinal.away].includes(projection.champion)) {
    problems.push(`champion ${projection.champion} is not in title final`);
  }
  const unresolved = projection.knockout.flat().filter((match) => /^(?:(?:W|RU)\d+|[123][A-L]+)$/.test(match.home) || /^(?:(?:W|RU)\d+|[123][A-L]+)$/.test(match.away));
  if (unresolved.length) problems.push(`unresolved knockout placeholders: ${unresolved.length}`);
  const brazilLast = projection.brazilPath.at(-1);
  if (brazilLast?.real && canonicalTeam(brazilLast.winner) !== "Brazil") {
    const simulation = simulateKnockout(projection, trainRatings(events.filter(isFinished)), events, 1000);
    if ((simulation?.title.find((team) => team.team === "Brazil")?.prob ?? 0) !== 0) problems.push("eliminated Brazil has non-zero title probability");
  }
  if (fifaRank("Brazil") !== 6) problems.push(`Brazil FIFA rank expected 6, got ${fifaRank("Brazil")}`);
  if (!metrics.matches || metrics.brier === null || metrics.logLoss === null || metrics.calibrationError === null) {
    problems.push("model metrics are empty or non-finite");
  }
  for (const [group, rows] of projection.groups) {
    if (rows.length !== 4) problems.push(`group ${group} has ${rows.length} teams`);
    for (const row of rows) {
      if (row.played > 3) problems.push(`${row.team} has ${row.played} group matches`);
      if (row.points > 9) problems.push(`${row.team} has ${row.points} group points`);
    }
  }

  const chart = tournamentFlameChartUrl(projection);
  if (!chart) problems.push("missing chart URL");
  const res = chart ? await fetch(chart, { method: "HEAD" }) : null;
  const chartStatus = res?.status ?? 0;
  const chartContentType = res?.headers.get("content-type") ?? "";
  const chartBytes = Number(res?.headers.get("content-length") ?? 0);
  if (chartStatus !== 200) problems.push(`chart status ${chartStatus}`);
  if (!chartContentType.includes("image/png")) problems.push(`chart content-type ${chartContentType}`);
  if (chartBytes < 10_000) problems.push(`chart too small: ${chartBytes} bytes`);

  if (send && chart) await sendPhoto(chart, `🔥 Homologação da Chama da Copa 2026 — ${projection.champion}`);

  return {
    groups: projection.groups.size,
    qualifiers: projection.qualifiers.length,
    rounds,
    champion: projection.champion,
    bracketSource: projection.bracketSource ?? "unknown",
    titleFinals,
    modelMetrics: { matches: metrics.matches, brier: metrics.brier, logLoss: metrics.logLoss, calibrationError: metrics.calibrationError },
    chartStatus,
    chartContentType,
    chartBytes,
    problems,
  };
}

export async function homologateFull(send = false): Promise<FullHomologationResult> {
  const problems: string[] = [];
  const events = await mergedSeasonEvents();
  const realEvents = events.filter((e) => /^\d+$/.test(e.idHomeTeam) && /^\d+$/.test(e.idAwayTeam));
  const teams = new Set(realEvents.flatMap((e) => [e.strHomeTeam, e.strAwayTeam]));

  if (events.length !== 104) problems.push(`expected 104 FIFA matches, got ${events.length}`);
  if (teams.size !== 48) problems.push(`expected 48 FIFA teams, got ${teams.size}`);
  for (const e of realEvents) {
    if (!e.idEvent) problems.push(`missing idEvent for ${e.strEvent}`);
    if (!e.strTimestamp) problems.push(`missing timestamp for ${e.strEvent}`);
    if (!e.strVenue) problems.push(`missing venue for ${e.strEvent}`);
  }

  const rosterByTeam = await Promise.all([...teams].map(async (team) => {
    const event = realEvents.find((e) => e.strHomeTeam === team || e.strAwayTeam === team);
    if (!event) return { team, players: 0 };
    const teamId = event.strHomeTeam === team ? event.idHomeTeam : event.idAwayTeam;
    const players = (await squadPlayers(teamId)).length;
    return { team, players };
  }));
  const rosterPlayers = rosterByTeam.reduce((sum, row) => sum + row.players, 0);
  for (const row of rosterByTeam) {
    if (row.players < 23) problems.push(`${row.team} roster too small: ${row.players}`);
  }
  if (rosterPlayers !== 1248) problems.push(`expected 1248 FIFA roster players, got ${rosterPlayers}`);

  const finished = events.filter(isFinished);
  const live = events.filter(isLive);
  if (!finished.length) problems.push("no finished matches from FIFA");

  const timelines = await Promise.all(finished.map(async (e) => ({ event: e, goals: await timeline(e.idEvent) })));
  const timelineGoals = timelines.reduce((sum, row) => sum + row.goals.length, 0);
  for (const row of timelines) {
    const scoreGoals = (Number(row.event.intHomeScore) || 0) + (Number(row.event.intAwayScore) || 0);
    if (row.goals.length < scoreGoals) {
      problems.push(`${row.event.strEvent} timeline goals ${row.goals.length} < score ${scoreGoals}`);
    }
  }

  const statsSamples = [...live, ...finished].slice(0, 8);
  const statsRows = await Promise.all(statsSamples.map((e) => eventStats(e.idEvent)));
  statsRows.forEach((rows, i) => {
    if (!rows.length) problems.push(`${statsSamples[i]!.strEvent} missing derived stats`);
  });

  const scorers = await topScorers();
  const leader = scorers[0] ?? null;
  if (!scorers.length) problems.push("missing player goal statistics");

  const production = {
    dockerfile: existsSync("Dockerfile"),
    deployWorkflow: existsSync(".github/workflows/deploy.yml"),
  };
  if (!production.dockerfile) problems.push("missing Dockerfile");
  if (!production.deployWorkflow) problems.push("missing deploy workflow");

  const endpoints = await fifaEndpointHealth();
  for (const endpoint of endpoints) {
    if (!endpoint.ok) problems.push(`${endpoint.name} endpoint unhealthy: ${endpoint.path}`);
  }

  const liveSample = live[0] ?? null;
  const liveLineup = liveSample ? await lineup(liveSample.idEvent) : [];
  const liveStarters = liveLineup.filter((p) => (p.strSubstitute ?? "").toLowerCase() !== "yes");
  const liveGoals = liveSample ? await timeline(liveSample.idEvent) : [];
  const liveGoalPlayers = await Promise.all(liveGoals.map(async (goal) =>
    goal.idPlayer ? await findPlayerById(goal.idPlayer) : null,
  ));
  const liveMedia = {
    match: liveSample?.strEvent ?? null,
    lineupPlayers: liveLineup.length,
    lineupPlayersWithPhoto: liveLineup.filter((p) => !!p.strThumb).length,
    starters: liveStarters.length,
    goals: liveGoals.length,
    goalsWithPlayerPhoto: liveGoalPlayers.filter((p) => !!(p?.strThumb || p?.strCutout)).length,
  };
  if (liveSample) {
    if (liveMedia.starters !== 22) problems.push(`${liveSample.strEvent} live lineup starters ${liveMedia.starters} != 22`);
    if (liveMedia.lineupPlayers === 0) problems.push(`${liveSample.strEvent} missing live lineup`);
    if (liveMedia.lineupPlayersWithPhoto !== liveMedia.lineupPlayers) {
      problems.push(`${liveSample.strEvent} live lineup photos ${liveMedia.lineupPlayersWithPhoto}/${liveMedia.lineupPlayers}`);
    }
    if (liveMedia.goalsWithPlayerPhoto !== liveMedia.goals) {
      problems.push(`${liveSample.strEvent} live goal photos ${liveMedia.goalsWithPlayerPhoto}/${liveMedia.goals}`);
    }
  }

  const forecast = await homologateForecast(send);
  problems.push(...forecast.problems.map((p) => `forecast: ${p}`));

  const result: FullHomologationResult = {
    source: "FIFA",
    matches: events.length,
    teams: teams.size,
    rosterPlayers,
    finishedMatches: finished.length,
    liveMatches: live.length,
    timelineChecked: timelines.length,
    timelineGoals,
    statsChecked: statsRows.length,
    playerStats: {
      scorers: scorers.length,
      leader: leader?.player ?? null,
      leaderGoals: leader?.goals ?? 0,
    },
    production,
    endpoints,
    liveMedia,
    forecast,
    problems,
  };
  if (send) await sendMessage(fmtFullHomologation(result));
  return result;
}

function fmtFullHomologation(result: FullHomologationResult): string {
  return [
    "✅ *HOMOLOGAÇÃO FIFA / PRODUÇÃO*",
    "",
    `Fonte: *${result.source}*`,
    `Jogos: *${result.matches}*`,
    `Seleções: *${result.teams}*`,
    `Jogadores em elencos oficiais: *${result.rosterPlayers}*`,
    `Jogos finalizados: *${result.finishedMatches}*`,
    `Jogos ao vivo agora: *${result.liveMatches}*`,
    `Timelines checadas: *${result.timelineChecked}*`,
    `Gols validados: *${result.timelineGoals}*`,
    `Artilheiros: *${result.playerStats.scorers}*`,
    `Líder: *${result.playerStats.leader ?? "-"}* (${result.playerStats.leaderGoals})`,
    `Endpoints FIFA: ${result.endpoints.map((e) => `${e.ok ? "OK" : "FAIL"} ${e.name} (${e.count})`).join(" · ")}`,
    `Live mídia: ${result.liveMedia.match ?? "-"} · escalação ${result.liveMedia.lineupPlayersWithPhoto}/${result.liveMedia.lineupPlayers} fotos · gols ${result.liveMedia.goalsWithPlayerPhoto}/${result.liveMedia.goals} fotos`,
    `Chama: *${result.forecast.champion}*`,
    "",
    result.problems.length ? `❌ Problemas: ${result.problems.join("; ")}` : "Sem problemas encontrados.",
  ].join("\n");
}
