import type { TableRow, WcEvent } from "./types.ts";
import { leagueTable, mergedSeasonEvents } from "./sportsdb.ts";
import { isFinished } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import { standingsChartUrl } from "./charts.ts";
import { tournamentProjection, type ProjectedTeam } from "./tournament.ts";

const num = (v: string | null | undefined) => Number(v ?? 0) || 0;
const FULL_FIELD = 48;
export type QualificationStatus = "qualified" | "eliminated" | "provisional";

const compareRows = (a: TableRow, b: TableRow): number =>
  num(b.intPoints) - num(a.intPoints) ||
  num(b.intGoalDifference) - num(a.intGoalDifference) ||
  num(b.intGoalsFor) - num(a.intGoalsFor) ||
  a.strTeam.localeCompare(b.strTeam);

/** Group rows by strGroup, sorted by points → goal difference → goals for. */
export function byGroup(rows: TableRow[]): Map<string, TableRow[]> {
  const groups = new Map<string, TableRow[]>();
  for (const r of rows) {
    const g = r.strGroup?.trim() || "—";
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
  }
  for (const list of groups.values()) {
    list.sort(compareRows);
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export function qualificationStatuses(rows: TableRow[]): Map<string, QualificationStatus> {
  const statuses = new Map(rows.map((row) => [row.strTeam, "provisional" as QualificationStatus]));
  const groups = byGroup(rows);
  const complete = groups.size === 12 && [...groups.values()].every((group) =>
    group.length === 4 && group.every((row) => num(row.intPlayed) >= 3));
  if (!complete) return statuses;

  for (const team of statuses.keys()) statuses.set(team, "eliminated");
  for (const group of groups.values()) {
    for (const row of group.slice(0, 2)) statuses.set(row.strTeam, "qualified");
  }
  const thirds = [...groups.values()].map((group) => group[2]!).sort(compareRows);
  for (const row of thirds.slice(0, 8)) statuses.set(row.strTeam, "qualified");
  return statuses;
}

export function fmtStandings(rows: TableRow[]): string {
  if (!rows.length) return "📊 *CLASSIFICAÇÃO* — _ainda sem dados de grupos._";
  const out = [`📊 *CLASSIFICAÇÃO — Copa do Mundo 2026*`, ``];
  const groups = byGroup(rows);
  const statuses = qualificationStatuses(rows);
  for (const [g, list] of groups) {
    out.push(`*${g}*`);
    out.push("`#  Time            P   J   SG`");
    list.forEach((r, i) => {
      const status = statuses.get(r.strTeam);
      const mark = status === "qualified" ? "✅" : status === "eliminated" ? "❌" : i < 2 ? "🟢" : "🟡";
      const name = `${r.strTeam}`.padEnd(14).slice(0, 14);
      const pts = String(num(r.intPoints)).padStart(2);
      const pj = String(num(r.intPlayed)).padStart(2);
      const sg = (num(r.intGoalDifference) >= 0 ? "+" : "") + num(r.intGoalDifference);
      out.push(`${mark}${i + 1} \`${name}\` *${pts}*  ${pj}  ${sg}`);
    });
    out.push("");
  }
  const complete = ![...statuses.values()].includes("provisional");
  if (complete) {
    const thirds = [...groups.values()].map((group) => group[2]!).sort(compareRows);
    out.push("*MELHORES TERCEIROS*", "`#  Time            P   SG  Situação`");
    thirds.forEach((row, index) => {
      const qualified = statuses.get(row.strTeam) === "qualified";
      const name = row.strTeam.padEnd(14).slice(0, 14);
      const gd = `${num(row.intGoalDifference) >= 0 ? "+" : ""}${num(row.intGoalDifference)}`;
      out.push(`${qualified ? "✅" : "❌"}${index + 1} \`${name}\` ${String(num(row.intPoints)).padStart(2)}  ${gd.padStart(3)}  ${qualified ? "classificado" : "eliminado"}`);
    });
    out.push("", "_✅ top 2 de cada grupo + 8 melhores terceiros; ❌ eliminado._");
  } else {
    out.push("_🟢 top 2 provisório · 🟡 disputa entre terceiros; classificação ainda não encerrada._");
  }
  return out.join("\n");
}

function projectedToRows(groups: Map<string, ProjectedTeam[]>): TableRow[] {
  return [...groups.entries()].flatMap(([group, teams]) =>
    teams.map((t, i) => ({
      intRank: String(i + 1),
      strTeam: t.team,
      strGroup: group,
      intPlayed: String(t.played),
      intWin: null,
      intDraw: null,
      intLoss: null,
      intGoalsFor: String(t.gf),
      intGoalsAgainst: String(t.ga),
      intGoalDifference: String(t.gf - t.ga),
      intPoints: String(t.points),
    })));
}

export async function currentStandingsRows(): Promise<TableRow[]> {
  const rows = await leagueTable();
  if (rows.length >= FULL_FIELD) return rows;
  return projectedToRows((await tournamentProjection()).groups);
}

export async function fmtCurrentStandings(): Promise<string> {
  const rows = await leagueTable();
  if (rows.length >= FULL_FIELD) return fmtStandings(rows);
  const projected = projectedToRows((await tournamentProjection()).groups);
  return `${fmtStandings(projected)}\n\n_API parcial (${rows.length}/${FULL_FIELD}); usando projeção com resultados recentes._`;
}

/** Projected qualifiers: top 2 of each group by current standings. */
export function isKnockoutEvent(e: WcEvent): boolean {
  return /final|round of|quarter|semi|16|32/i.test(`${e.strStage ?? ""} ${e.strEvent}`);
}

export async function fmtKnockout(): Promise<string> {
  const events = await mergedSeasonEvents();
  const knockout = events.filter(isKnockoutEvent);
  if (knockout.length) return fmtRealBracket(knockout);

  const groups = byGroup(await currentStandingsRows());
  const lines = [
    `🗺️ *MATA-MATA — projeção*`,
    `_O chaveamento oficial sai após a fase de grupos. Projeção pelos líderes atuais + resultados recentes:_`,
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
  const rows = await currentStandingsRows();
  await sendMessage(await fmtCurrentStandings());
  const chart = standingsChartUrl(rows);
  if (chart) await sendPhoto(chart, "📊 Classificação — Copa do Mundo 2026");
}

export async function postKnockout(): Promise<void> {
  await sendMessage(await fmtKnockout());
}
