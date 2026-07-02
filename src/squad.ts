import type { LineupPlayer } from "./types.ts";
import { mergedSeasonEvents, squadPlayers } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMediaGroupStrict, sendMessage } from "./telegram.ts";

/** Resolves a team's FIFA idTeam from any match it played this season. */
export async function findTeamId(query: string): Promise<{ id: string; name: string } | null> {
  const q = query.trim().toLowerCase();
  const events = await mergedSeasonEvents();
  for (const e of events) {
    if (e.strHomeTeam.toLowerCase().includes(q)) return { id: e.idHomeTeam, name: e.strHomeTeam };
    if (e.strAwayTeam.toLowerCase().includes(q)) return { id: e.idAwayTeam, name: e.strAwayTeam };
  }
  return null;
}

export function fmtSquad(teamName: string, players: LineupPlayer[]): string {
  if (!players.length) return "";
  const line = (p: LineupPlayer) =>
    `   ${p.intSquadNumber ? `#${p.intSquadNumber} ` : ""}${p.strPlayer}${p.strPosition ? ` _(${p.strPosition})_` : ""}`;
  return [
    `👥 *ELENCO OFICIAL FIFA* — ${flag(teamName)} ${teamName}`,
    ``,
    ...players.map(line),
  ].join("\n");
}

export async function postSquad(query: string): Promise<LineupPlayer[]> {
  const team = await findTeamId(query);
  if (!team) { console.error(`no team matching "${query}"`); return []; }
  const players = await squadPlayers(team.id);
  const msg = fmtSquad(team.name, players);
  if (!msg) return players;
  const photos = players.map((p) => p.strThumb).filter((x): x is string => !!x);
  for (let i = 0; i < photos.length; i += 10) {
    await sendMediaGroupStrict(photos.slice(i, i + 10), `📸 Elenco ${team.name}`);
  }
  await sendMessage(msg);
  return players;
}
