import type { TableRow, WcEvent } from "./types.ts";
import { leagueTable, seasonEvents } from "./sportsdb.ts";
import { isFinished } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { standingsChartUrl } from "./charts.ts";

const num = (v: string | null | undefined) => Number(v ?? 0) || 0;

/** Group rows by strGroup, sorted by points → goal difference → goals for. */
export function byGroup(rows: TableRow[]): Map<string, TableRow[]> {
  const groups = new Map<string, TableRow[]>();
  for (const r of rows) {
    const g = r.strGroup?.trim() || "—";
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
  }
  for (const list of groups.values()) {
    list.sort((a, b) =>
      num(b.intPoints) - num(a.intPoints) ||
      num(b.intGoalDifference) - num(a.intGoalDifference) ||
      num(b.intGoalsFor) - num(a.intGoalsFor) ||
      a.strTeam.localeCompare(b.strTeam));
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export function fmtStandings(rows: TableRow[]): string {
  if (!rows.length) return "📊 *CLASSIFICAÇÃO* — _ainda sem dados de grupos._";
  const out = [`📊 *CLASSIFICAÇÃO — Copa do Mundo 2026*`, ``];
  for (const [g, list] of byGroup(rows)) {
    out.push(`*${g}*`);
    out.push("`#  Time            P   J   SG`");
    list.forEach((r, i) => {
      const mark = i < 2 ? "🟢" : "⚪";
      const name = `${r.strTeam}`.padEnd(14).slice(0, 14);
      const pts = String(num(r.intPoints)).padStart(2);
      const pj = String(num(r.intPlayed)).padStart(2);
      const sg = (num(r.intGoalDifference) >= 0 ? "+" : "") + num(r.intGoalDifference);
      out.push(`${mark}${i + 1} \`${name}\` *${pts}*  ${pj}  ${sg}`);
    });
    out.push("");
  }
  out.push("_🟢 zona de classificação (top 2 do grupo)_");
  return out.join("\n");
}

/** Projected qualifiers: top 2 of each group by current standings. */
export async function fmtKnockout(): Promise<string> {
  const events = await seasonEvents();
  const knockout = events.filter((e) => num(e.intRound) >= 2 || /final|round of|quarter|semi|16|32/i.test(e.strEvent));
  if (knockout.length) return fmtRealBracket(knockout);

  const groups = byGroup(await leagueTable());
  const lines = [
    `🗺️ *MATA-MATA — projeção*`,
    `_O chaveamento oficial sai após a fase de grupos. Projeção pelos líderes atuais:_`,
    ``,
  ];
  for (const [g, list] of groups) {
    const q = list.slice(0, 2).map((r, i) =>
      `${i === 0 ? "1º" : "2º"} ${flag(r.strTeam)} ${r.strTeam}`).join("  ·  ");
    lines.push(`*${g}:* ${q || "—"}`);
  }
  return lines.join("\n");
}

function fmtRealBracket(events: WcEvent[]): string {
  const sorted = [...events].sort((a, b) => (a.strTimestamp ?? "").localeCompare(b.strTimestamp ?? ""));
  const lines = [`🏆 *MATA-MATA — Copa do Mundo 2026*`, ``];
  for (const e of sorted) {
    const score = isFinished(e)
      ? ` — *${e.intHomeScore} x ${e.intAwayScore}*`
      : ` _(${e.dateEvent})_`;
    lines.push(`${flag(e.strHomeTeam)} ${e.strHomeTeam} x ${e.strAwayTeam} ${flag(e.strAwayTeam)}${score}`);
  }
  return lines.join("\n");
}

export async function postStandings(): Promise<void> {
  const rows = await leagueTable();
  await sendMessage(fmtStandings(rows));
  const chart = standingsChartUrl(rows);
  if (chart) await sendPhoto(chart, "📊 Classificação — Copa do Mundo 2026");
}

export async function postKnockout(): Promise<void> {
  await sendMessage(await fmtKnockout());
}
