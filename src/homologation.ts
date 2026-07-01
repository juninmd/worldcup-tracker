import { tournamentFlameChartUrl } from "./charts.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { tournamentProjection } from "./tournament.ts";
import { eventStats, isFinished, isLive, lineup, mergedSeasonEvents, timeline } from "./sportsdb.ts";
import { topScorers } from "./scorers.ts";
import { existsSync } from "node:fs";

export interface HomologationResult {
  groups: number;
  qualifiers: number;
  rounds: number[];
  champion: string;
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
  forecast: HomologationResult;
  problems: string[];
}

export async function homologateForecast(send = false): Promise<HomologationResult> {
  const projection = await tournamentProjection();
  const problems: string[] = [];
  const rounds = projection.knockout.map((r) => r.length);

  if (projection.groups.size !== 12) problems.push(`expected 12 groups, got ${projection.groups.size}`);
  if (projection.qualifiers.length !== 32) problems.push(`expected 32 qualifiers, got ${projection.qualifiers.length}`);
  if (rounds.join(",") !== "16,8,4,2,1") problems.push(`expected knockout 16,8,4,2,1, got ${rounds.join(",")}`);
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
    const players = await lineupForTeam(teamId, event.idEvent, team === event.strHomeTeam);
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
  if (!live.length) problems.push("no live matches from FIFA right now");

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
    forecast,
    problems,
  };
  if (send) await sendMessage(fmtFullHomologation(result));
  return result;
}

async function lineupForTeam(teamId: string, sampleEventId: string, home: boolean): Promise<number> {
  return (await lineup(sampleEventId)).filter((p) => (p.strHome ?? "").toLowerCase() === (home ? "yes" : "no")).length;
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
    `Chama: *${result.forecast.champion}*`,
    "",
    result.problems.length ? `❌ Problemas: ${result.problems.join("; ")}` : "Sem problemas encontrados.",
  ].join("\n");
}
