import { championForecast } from "./champion.ts";
import { predictMatch } from "./predict.ts";
import { postDailyMenu, ratingsNow, replayDate, trackForever } from "./engine.ts";
import { postTournamentProjection } from "./engine.ts";
import { mergedSeasonEvents } from "./sportsdb.ts";
import { fmtScorers, postTopScorers, topScorers } from "./scorers.ts";
import { fmtCards, postTopCards, topCards } from "./cards.ts";
import { buildMatchDigest, analyzeMatch, fmtAnalysis, postMatchAnalysis } from "./analysis.ts";
import { fmtVenues, postVenues, venueTable } from "./venues.ts";
import { findTeamId, fmtSquad, postSquad } from "./squad.ts";
import { squadPlayers } from "./sportsdb.ts";
import { fmtTrivia, postTrivia, trivia } from "./trivia.ts";
import { fmtGoalTimes, goalTimeDistribution, postGoalTimes } from "./goaltimes.ts";
import { fmtLive, liveMatches, postLive } from "./live.ts";
import { fmtHighlights, highlightMatches, postHighlights } from "./highlights.ts";
import { fmtHeadToHead, headToHead, postHeadToHead } from "./h2h.ts";
import { fmtStreaks, postStreaks, streaks } from "./streaks.ts";
import { confederationTable, fmtConfederations, postConfederations } from "./confederations.ts";
import { postTournamentInfo, fmtTournamentInfo } from "./tourneyinfo.ts";
import { tournamentInfo } from "./sportsdb.ts";
import { postDetails } from "./details.ts";
import { fmtCurrentStandings, fmtKnockout, postStandings, postKnockout } from "./standings.ts";
import { fmtTournamentProjection, tournamentProjection } from "./tournament.ts";
import { homologateForecast, homologateFull, homologateTelegramDryRun } from "./homologation.ts";

function todayBRT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "menu": {
    await postDailyMenu(rest[0] ?? todayBRT());
    console.log("Daily menu sent.");
    break;
  }
  case "track":
    await trackForever();
    break;
  case "homologate":
  case "replay": {
    if (rest[0] === "full" || rest[0] === "production" || rest[0] === "prod") {
      const result = await homologateFull(rest.includes("--send"));
      console.log(JSON.stringify(result, null, 2));
      if (result.problems.length) process.exitCode = 1;
      break;
    }
    if (rest[0] === "forecast" || rest[0] === "chama") {
      const result = await homologateForecast(rest.includes("--send"));
      console.log(JSON.stringify(result, null, 2));
      if (result.problems.length) process.exitCode = 1;
      break;
    }
    if (rest[0] === "telegram" || rest[0] === "telegram-dry-run") {
      const result = await homologateTelegramDryRun();
      const out = rest.includes("--verbose") ? result : { ...result, mediaChecks: undefined };
      console.log(JSON.stringify(out, null, 2));
      if (result.problems.length) process.exitCode = 1;
      break;
    }
    await replayDate(rest[0] ?? "2026-06-13");
    console.log("Replay done.");
    break;
  }
  case "predict": {
    const { all, table } = await ratingsNow();
    const [home, away] = [rest[0], rest[1]];
    if (!home || !away) { console.error("usage: predict <Home> <Away>"); break; }
    console.log(predictMatch(table, home, away, all));
    break;
  }
  case "scorers": {
    if (rest[0] === "--send") { await postTopScorers(); console.log("Scorers sent."); break; }
    console.log(fmtScorers(await topScorers()));
    break;
  }
  case "venues":
  case "estadios": {
    if (rest[0] === "--send") { await postVenues(); console.log("Venues sent."); break; }
    console.log(fmtVenues(await venueTable()));
    break;
  }
  case "squad":
  case "elenco": {
    const q = rest.filter((r) => r !== "--send").join(" ");
    if (!q) { console.error("usage: squad <team> [--send]"); break; }
    if (rest.includes("--send")) { await postSquad(q); console.log("Squad sent."); break; }
    const team = await findTeamId(q);
    if (!team) { console.error(`no team matching "${q}"`); break; }
    console.log(fmtSquad(team.name, await squadPlayers(team.id)));
    break;
  }
  case "trivia":
  case "curiosidades": {
    if (rest[0] === "--send") { await postTrivia(); console.log("Trivia sent."); break; }
    console.log(fmtTrivia(await trivia()));
    break;
  }
  case "goaltimes":
  case "minutos": {
    if (rest[0] === "--send") { await postGoalTimes(); console.log("Goal times sent."); break; }
    console.log(fmtGoalTimes(await goalTimeDistribution()));
    break;
  }
  case "live":
  case "aovivo": {
    if (rest[0] === "--send") { await postLive(); console.log("Live sent."); break; }
    console.log(fmtLive(await liveMatches()));
    break;
  }
  case "highlights":
  case "melhores": {
    if (rest[0] === "--send") { await postHighlights(); console.log("Highlights sent."); break; }
    console.log(fmtHighlights(await highlightMatches()));
    break;
  }
  case "h2h":
  case "confronto": {
    const send = rest.includes("--send");
    const [a, b] = rest.filter((r) => r !== "--send");
    if (!a || !b) { console.error("usage: h2h <TeamA> <TeamB> [--send]"); break; }
    if (send) { await postHeadToHead(a, b); console.log("H2H sent."); break; }
    console.log(fmtHeadToHead(await headToHead(a, b), a, b));
    break;
  }
  case "streaks":
  case "sequencias": {
    if (rest[0] === "--send") { await postStreaks(); console.log("Streaks sent."); break; }
    console.log(fmtStreaks(await streaks()));
    break;
  }
  case "confederations":
  case "confederacoes": {
    if (rest[0] === "--send") { await postConfederations(); console.log("Confederations sent."); break; }
    console.log(fmtConfederations(await confederationTable()));
    break;
  }
  case "info":
  case "sobre": {
    if (rest[0] === "--send") { await postTournamentInfo(); console.log("Tournament info sent."); break; }
    console.log(fmtTournamentInfo(await tournamentInfo()));
    break;
  }
  case "details": {
    const q = (rest[0] ?? "").toLowerCase();
    const e = (await mergedSeasonEvents()).find((x) => x.strEvent.toLowerCase().includes(q));
    if (!e) { console.error(`no event matching "${rest[0]}"`); break; }
    await postDetails(e);
    console.log(`Details sent: ${e.strEvent}`);
    break;
  }
  case "cards": {
    if (rest[0] === "--send") { await postTopCards(); console.log("Cards sent."); break; }
    console.log(fmtCards(await topCards()));
    break;
  }
  case "analysis":
  case "analise": {
    const send = rest[rest.length - 1] === "--send";
    const q = (send ? rest.slice(0, -1) : rest).join(" ").toLowerCase();
    const e = (await mergedSeasonEvents()).find((x) => x.strEvent.toLowerCase().includes(q));
    if (!e) { console.error(`no event matching "${q}"`); break; }
    if (send) {
      await postMatchAnalysis(e);
      console.log(`Analysis sent: ${e.strEvent}`);
      break;
    }
    const digest = await buildMatchDigest(e);
    const analysis = await analyzeMatch(digest);
    console.log(fmtAnalysis(digest, analysis));
    break;
  }
  case "standings":
  case "tabela": {
    if (rest[0] === "--send") { await postStandings(); console.log("Standings sent."); break; }
    console.log(await fmtCurrentStandings());
    break;
  }
  case "bracket":
  case "mata-mata": {
    if (rest[0] === "--send") { await postKnockout(); console.log("Knockout sent."); break; }
    console.log(await fmtKnockout());
    break;
  }
  case "forecast":
  case "chama": {
    if (rest[0] === "--send") { await postTournamentProjection(); console.log("Tournament projection sent."); break; }
    console.log(fmtTournamentProjection(await tournamentProjection()));
    break;
  }
  case "champion": {
    const { table, all } = await ratingsNow();
    const teams = [...new Set(all.flatMap((e) => [e.strHomeTeam, e.strAwayTeam]))];
    for (const c of championForecast(table, teams).slice(0, 10))
      console.log(`${(c.prob * 100).toFixed(1)}%  ${c.team} (Elo ${c.elo}, elenco +${c.playerQuality}, força ${c.strength})`);
    break;
  }
  default:
    console.log("commands: menu [date] | track | homologate [date|forecast|full|telegram-dry-run] [--send] | predict <H> <A> | champion | forecast [--send] | scorers [--send] | cards [--send] | venues [--send] | squad <team> [--send] | trivia [--send] | goaltimes [--send] | live [--send] | highlights [--send] | h2h <A> <B> [--send] | streaks [--send] | confederations [--send] | info [--send] | details <team> | analysis <team> [--send] | standings [--send] | bracket [--send]");
    console.log("merged events:", (await mergedSeasonEvents()).length);
}
