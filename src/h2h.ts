import type { WcEvent } from "./types.ts";
import { canonicalTeam } from "./elo.ts";
import { isFinished, mergedSeasonEvents } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage } from "./telegram.ts";

export interface HeadToHead {
  teamA: string;
  teamB: string;
  matches: WcEvent[];
  winsA: number;
  winsB: number;
  draws: number;
  goalsA: number;
  goalsB: number;
}

/** Every finished meeting between two teams so far this tournament. */
export async function headToHead(queryA: string, queryB: string): Promise<HeadToHead | null> {
  const all = (await mergedSeasonEvents()).filter(isFinished);
  const a = canonicalTeam(queryA), b = canonicalTeam(queryB);
  const matches = all.filter((e) => {
    const h = canonicalTeam(e.strHomeTeam), aw = canonicalTeam(e.strAwayTeam);
    return (h === a && aw === b) || (h === b && aw === a);
  });
  if (!matches.length) return null;

  const teamA = matches[0]!.strHomeTeam && canonicalTeam(matches[0]!.strHomeTeam) === a ? matches[0]!.strHomeTeam : matches[0]!.strAwayTeam;
  const teamB = teamA === matches[0]!.strHomeTeam ? matches[0]!.strAwayTeam : matches[0]!.strHomeTeam;

  let winsA = 0, winsB = 0, draws = 0, goalsA = 0, goalsB = 0;
  for (const e of matches) {
    const hs = Number(e.intHomeScore) || 0, as = Number(e.intAwayScore) || 0;
    const homeIsA = canonicalTeam(e.strHomeTeam) === a;
    const [gA, gB] = homeIsA ? [hs, as] : [as, hs];
    goalsA += gA; goalsB += gB;
    if (gA > gB) winsA++; else if (gB > gA) winsB++; else draws++;
  }
  return { teamA, teamB, matches, winsA, winsB, draws, goalsA, goalsB };
}

export function fmtHeadToHead(h: HeadToHead | null, queryA: string, queryB: string): string {
  if (!h) return `🤝 *CONFRONTO DIRETO* — _${queryA} e ${queryB} ainda não se enfrentaram nesta Copa._`;
  const rows = h.matches.map((e) => `   ${e.dateEvent}: ${e.strHomeTeam} ${e.intHomeScore} x ${e.intAwayScore} ${e.strAwayTeam}`);
  return [
    `🤝 *CONFRONTO DIRETO* — ${flag(h.teamA)} ${h.teamA} x ${h.teamB} ${flag(h.teamB)}`,
    ``,
    `${h.teamA} ${h.winsA} · ${h.draws} empates · ${h.winsB} ${h.teamB}`,
    `Gols: ${h.teamA} ${h.goalsA} x ${h.goalsB} ${h.teamB}`,
    ``,
    ...rows,
  ].join("\n");
}

export async function postHeadToHead(queryA: string, queryB: string): Promise<void> {
  const h = await headToHead(queryA, queryB);
  await sendMessage(fmtHeadToHead(h, queryA, queryB));
}
