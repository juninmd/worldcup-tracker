import { championForecast } from "./champion.ts";
import { predictMatch } from "./predict.ts";
import { postDailyMenu, ratingsNow, replayDate, trackForever } from "./engine.ts";
import { postTournamentProjection } from "./engine.ts";
import { mergedSeasonEvents } from "./sportsdb.ts";
import { fmtScorers, postTopScorers, topScorers } from "./scorers.ts";
import { fmtCards, postTopCards, topCards } from "./cards.ts";
import { buildMatchDigest, analyzeMatch, fmtAnalysis, postMatchAnalysis } from "./analysis.ts";
import { postDetails } from "./details.ts";
import { fmtCurrentStandings, fmtKnockout, postStandings, postKnockout } from "./standings.ts";
import { fmtTournamentProjection, tournamentProjection } from "./tournament.ts";
import { homologateForecast, homologateFull } from "./homologation.ts";

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
    console.log("commands: menu [date] | track | homologate [date|forecast|full] [--send] | predict <H> <A> | champion | forecast [--send] | scorers [--send] | cards [--send] | details <team> | analysis <team> [--send] | standings [--send] | bracket [--send]");
    console.log("merged events:", (await mergedSeasonEvents()).length);
}
