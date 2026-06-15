import { championForecast } from "./champion.ts";
import { predictMatch } from "./predict.ts";
import { postDailyMenu, ratingsNow, replayDate, trackForever } from "./engine.ts";
import { seasonEvents } from "./sportsdb.ts";
import { fmtScorers, postTopScorers, topScorers } from "./scorers.ts";
import { postDetails } from "./details.ts";

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
    await replayDate(rest[0] ?? "2026-06-13");
    console.log("Replay done.");
    break;
  }
  case "predict": {
    const { table } = await ratingsNow();
    const [home, away] = [rest[0], rest[1]];
    if (!home || !away) { console.error("usage: predict <Home> <Away>"); break; }
    console.log(predictMatch(table, home, away));
    break;
  }
  case "scorers": {
    if (rest[0] === "--send") { await postTopScorers(); console.log("Scorers sent."); break; }
    console.log(fmtScorers(await topScorers()));
    break;
  }
  case "details": {
    const q = (rest[0] ?? "").toLowerCase();
    const e = (await seasonEvents()).find((x) => x.strEvent.toLowerCase().includes(q));
    if (!e) { console.error(`no event matching "${rest[0]}"`); break; }
    await postDetails(e);
    console.log(`Details sent: ${e.strEvent}`);
    break;
  }
  case "champion": {
    const { table, all } = await ratingsNow();
    const teams = [...new Set(all.flatMap((e) => [e.strHomeTeam, e.strAwayTeam]))];
    for (const c of championForecast(table, teams).slice(0, 10))
      console.log(`${(c.prob * 100).toFixed(1)}%  ${c.team} (Elo ${c.elo})`);
    break;
  }
  default:
    console.log("commands: menu [date] | track | homologate [date] | predict <H> <A> | champion | scorers [--send] | details <team>");
    console.log("season events:", (await seasonEvents()).length);
}
