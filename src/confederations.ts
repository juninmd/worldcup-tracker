import { isFinished, mergedSeasonEvents, teamConfederation } from "./sportsdb.ts";
import { sendMessage } from "./telegram.ts";

export interface ConfederationEntry {
  confederation: string;
  teams: number;
  goals: number;
  matches: number;
}

/** Teams, goals and matches played so far, grouped by FIFA confederation (UEFA, CONMEBOL, AFC…). */
export async function confederationTable(): Promise<ConfederationEntry[]> {
  const all = await mergedSeasonEvents();
  const teamIds = new Map<string, string>(); // team name -> idTeam
  // Knockout-stage fixtures not yet decided carry placeholder ids ("A1", "B2"…)
  // instead of a real numeric FIFA idTeam — skip those, they aren't teams.
  const isRealTeamId = (id: string) => /^\d+$/.test(id);
  for (const e of all) {
    if (isRealTeamId(e.idHomeTeam)) teamIds.set(e.strHomeTeam, e.idHomeTeam);
    if (isRealTeamId(e.idAwayTeam)) teamIds.set(e.strAwayTeam, e.idAwayTeam);
  }

  const confByTeam = new Map<string, string>();
  await Promise.all(
    [...teamIds].map(async ([team, id]) => {
      const c = await teamConfederation(id).catch(() => null);
      confByTeam.set(team, c?.confederationName ?? "Desconhecida");
    }),
  );

  const tally = new Map<string, ConfederationEntry>();
  const bump = (team: string) => {
    const conf = confByTeam.get(team) ?? "Desconhecida";
    return tally.get(conf) ?? tally.set(conf, { confederation: conf, teams: 0, goals: 0, matches: 0 }).get(conf)!;
  };
  for (const team of teamIds.keys()) bump(team).teams++;

  for (const e of all.filter(isFinished)) {
    const home = bump(e.strHomeTeam), away = bump(e.strAwayTeam);
    home.matches++; away.matches++;
    home.goals += Number(e.intHomeScore) || 0;
    away.goals += Number(e.intAwayScore) || 0;
  }
  return [...tally.values()].sort((a, b) => b.goals - a.goals);
}

export function fmtConfederations(list: ConfederationEntry[]): string {
  if (!list.length) return "🌍 *CONFEDERAÇÕES* — _sem dados disponíveis._";
  const rows = list.map((c) =>
    `🌍 *${c.confederation}* — ${c.teams} seleções · ${c.goals} gols em ${c.matches} jogos disputados`,
  );
  return [`🌍 *DESEMPENHO POR CONFEDERAÇÃO — Copa do Mundo 2026*`, ``, ...rows].join("\n");
}

export async function postConfederations(): Promise<ConfederationEntry[]> {
  const list = await confederationTable();
  await sendMessage(fmtConfederations(list));
  return list;
}
