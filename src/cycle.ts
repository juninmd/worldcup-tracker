import type { WcEvent } from "./types.ts";
import { canonicalTeam, trainRatings } from "./elo.ts";
import { WC2030 } from "./cycle2030.ts";
import { brazilFixtures, competitionFixtures, mergedSeasonEvents } from "./sportsdb.ts";

/** FIFA competition ids the calendar feed uses outside the World Cup itself. */
export const QUALIFIERS_COMPETITION_ID = "520"; // "FIFA World Cup™ Qualifiers" (CONMEBOL)
export const FRIENDLIES_COMPETITION_ID = "cesdwwnxbc5fmajgroc0hqzy2";

/** The 2030 cycle runs from the day after the 2026 final (19 Jul 2026) to the
 *  centenary opener in Montevideo. Everything a national team plays in between —
 *  qualifiers, friendlies, continental cups — is cycle evidence for the model. */
export const CYCLE = { startDate: "2026-07-20", endDate: WC2030.openerDate } as const;

export type CycleKind = "qualifier" | "friendly" | "other";

export interface CycleMatch {
  event: WcEvent;
  kind: CycleKind;
}

export function classifyCycleMatch(e: WcEvent): CycleKind {
  if (e.idCompetition === QUALIFIERS_COMPETITION_ID) return "qualifier";
  if (e.idCompetition === FRIENDLIES_COMPETITION_ID) return "friendly";
  return "other";
}

const iso = (date: string) => `${date}T00:00:00Z`;

/** A cycle match counts once it has a real scoreline. Deliberately keyed off the
 *  score rather than the status string: `Number(null)` is 0, not NaN, so a fixture
 *  with no score would otherwise be tallied — and trained on — as a 0–0 draw. */
export function isPlayed(e: WcEvent): boolean {
  if (e.intHomeScore === null || e.intHomeScore === undefined) return false;
  if (e.intAwayScore === null || e.intAwayScore === undefined) return false;
  return !Number.isNaN(Number(e.intHomeScore)) && !Number.isNaN(Number(e.intAwayScore));
}

/** The FIFA calendar answers a bare `null` for windows wider than about a year —
 *  silently, with no error — so the four-year cycle has to be asked for one year at
 *  a time and stitched back together. */
export function yearlyWindows(startDate: string, endDate: string): [string, string][] {
  const windows: [string, string][] = [];
  const end = Date.parse(iso(endDate));
  for (let cursor = Date.parse(iso(startDate)); cursor <= end; ) {
    const next = new Date(cursor);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    const stop = Math.min(next.getTime(), end);
    windows.push([new Date(cursor).toISOString().slice(0, 10), new Date(stop).toISOString().slice(0, 10)]);
    if (stop >= end) break;
    cursor = stop + 86_400_000;
  }
  return windows;
}

/** All published cycle matches: the full CONMEBOL qualifying competition plus
 *  Brazil's own agenda (friendlies and anything else it plays). */
export async function cycleMatches(): Promise<CycleMatch[]> {
  const windows = yearlyWindows(CYCLE.startDate, CYCLE.endDate);
  const batches = await Promise.all(windows.flatMap(([from, to]) => [
    competitionFixtures(QUALIFIERS_COMPETITION_ID, iso(from), iso(to)).catch(() => []),
    brazilFixtures(iso(from), iso(to)).catch(() => []),
  ]));
  const [qualifiers, brazil] = [batches.filter((_, i) => i % 2 === 0).flat(), batches.filter((_, i) => i % 2 === 1).flat()];
  const seen = new Set<string>();
  const out: CycleMatch[] = [];
  for (const e of [...qualifiers, ...brazil]) {
    if (seen.has(e.idEvent)) continue;
    seen.add(e.idEvent);
    out.push({ event: e, kind: classifyCycleMatch(e) });
  }
  return out.sort((a, b) =>
    (a.event.strTimestamp ?? a.event.dateEvent).localeCompare(b.event.strTimestamp ?? b.event.dateEvent));
}

/** Finished cycle matches as plain events. Between World Cups the 2026 season feed
 *  stops moving, so this is the only thing that keeps the rating table learning —
 *  without it every prediction until 2030 runs on the ratings frozen at the final.
 *  Returns nothing before the cycle opens, so mid-tournament callers pay no fetch. */
export async function finishedCycleEvents(now = new Date()): Promise<WcEvent[]> {
  if (now.getTime() < Date.parse(iso(CYCLE.startDate))) return [];
  return (await cycleMatches()).map((m) => m.event).filter(isPlayed);
}

export interface QualRow {
  rank: number;
  team: string;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  diff: number;
  points: number;
}

/** Competition 520 is FIFA's global qualifying competition — every confederation
 *  lands in it. Only CONMEBOL plays a single all-play-all group, so it's the one
 *  whose table can be built as a straight league; the others are split into groups
 *  the calendar feed doesn't label. */
export const CONMEBOL_TEAMS = [
  "Argentina", "Bolivia", "Brazil", "Chile", "Colombia",
  "Ecuador", "Paraguay", "Peru", "Uruguay", "Venezuela",
] as const;

/** CONMEBOL qualifying table from played matches: 3/1/0, then goal difference and
 *  goals scored — the confederation's own tie-breaking order. */
export function qualifyingTable(matches: CycleMatch[], teams: readonly string[] = CONMEBOL_TEAMS): QualRow[] {
  const pool = new Set(teams.map(canonicalTeam));
  const rows = new Map<string, QualRow>();
  const row = (team: string) => {
    const key = canonicalTeam(team);
    const hit = rows.get(key);
    if (hit) return hit;
    const next: QualRow = { rank: 0, team: key, played: 0, win: 0, draw: 0, loss: 0, goalsFor: 0, goalsAgainst: 0, diff: 0, points: 0 };
    rows.set(key, next);
    return next;
  };
  for (const { event: e, kind } of matches) {
    if (kind !== "qualifier" || !isPlayed(e)) continue;
    if (!pool.has(canonicalTeam(e.strHomeTeam)) || !pool.has(canonicalTeam(e.strAwayTeam))) continue;
    const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);
    const h = row(e.strHomeTeam), a = row(e.strAwayTeam);
    h.played++; a.played++;
    h.goalsFor += hs; h.goalsAgainst += as;
    a.goalsFor += as; a.goalsAgainst += hs;
    if (hs > as) { h.win++; a.loss++; h.points += 3; }
    else if (hs < as) { a.win++; h.loss++; a.points += 3; }
    else { h.draw++; a.draw++; h.points++; a.points++; }
  }
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, diff: r.goalsFor - r.goalsAgainst }))
    .sort((x, y) => y.points - x.points || y.diff - x.diff || y.goalsFor - x.goalsFor || x.team.localeCompare(y.team));
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface EloMove {
  team: string;
  before: number;
  after: number;
  delta: number;
}

/** Ratings carried through the cycle: the 2026 table trained further on every
 *  finished cycle match, so the model keeps learning between World Cups instead of
 *  cold-starting in 2030. Returns the teams that moved most. */
export function cycleEloMoves(worldCup: WcEvent[], matches: CycleMatch[], limit = 6): EloMove[] {
  const finishedCycle = matches.map((m) => m.event).filter(isPlayed);
  if (!finishedCycle.length) return [];
  const playedWorldCup = worldCup.filter(isPlayed);
  const before = trainRatings(playedWorldCup);
  const after = trainRatings([...playedWorldCup, ...finishedCycle]);
  const touched = new Set(finishedCycle.flatMap((e) => [canonicalTeam(e.strHomeTeam), canonicalTeam(e.strAwayTeam)]));
  return [...touched]
    .map((team) => ({
      team,
      before: Math.round(before[team] ?? 1500),
      after: Math.round(after[team] ?? 1500),
      delta: Math.round((after[team] ?? 1500) - (before[team] ?? 1500)),
    }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

export interface CycleSnapshot {
  matches: CycleMatch[];
  table: QualRow[];
  eloMoves: EloMove[];
  played: number;
  upcoming: CycleMatch[];
}

export async function cycleSnapshot(): Promise<CycleSnapshot> {
  const matches = await cycleMatches();
  const worldCup = await mergedSeasonEvents().catch(() => [] as WcEvent[]);
  return {
    matches,
    table: qualifyingTable(matches),
    eloMoves: cycleEloMoves(worldCup, matches),
    played: matches.filter((m) => isPlayed(m.event)).length,
    upcoming: matches.filter((m) => !isPlayed(m.event)).slice(0, 5),
  };
}

// CONMEBOL's 2026 allocation: top 6 qualify directly, 7th goes to the inter-confederation
// play-off. FIFA has not published the 2030 allocation — the three South American
// centenary hosts may yet take automatic slots — so the cut lines are drawn as the
// previous cycle's rule and labelled as such rather than stated as fact.
const DIRECT_SLOTS = 6;
const PLAYOFF_SLOT = 7;

const KIND_LABEL: Record<CycleKind, string> = {
  qualifier: "Eliminatórias",
  friendly: "Amistoso",
  other: "Outros",
};

export function fmtCycleStandings(snap: CycleSnapshot): string {
  const lines = [`📊 *CLASSIFICAÇÃO DO CICLO 2030* — CONMEBOL`];
  if (!snap.table.length) {
    lines.push(
      `_As Eliminatórias da CONMEBOL para 2030 ainda não foram publicadas no calendário da FIFA._`,
      `A tabela aparece sozinha aqui assim que a primeira rodada for disputada.`,
    );
  } else {
    lines.push("```", `#  Seleção         P   J   V   E   D   SG`);
    for (const r of snap.table) {
      const mark = r.rank <= DIRECT_SLOTS ? "✅" : r.rank === PLAYOFF_SLOT ? "🟡" : "  ";
      lines.push(
        `${String(r.rank).padStart(2)}${mark}${r.team.slice(0, 14).padEnd(15)}`
        + `${String(r.points).padStart(2)}  ${String(r.played).padStart(2)}  ${String(r.win).padStart(2)}  `
        + `${String(r.draw).padStart(2)}  ${String(r.loss).padStart(2)}  ${(r.diff > 0 ? "+" : "") + r.diff}`,
      );
    }
    lines.push("```", `✅ vaga direta · 🟡 repescagem — _corte pela regra do ciclo 2026; a FIFA ainda não definiu as vagas de 2030._`);
  }

  if (snap.eloMoves.length) {
    lines.push(``, `📈 *Elo do ciclo* (a partir do fim da Copa de 2026)`);
    for (const m of snap.eloMoves) {
      lines.push(`• ${m.delta > 0 ? "🔺" : "🔻"} ${m.team}: ${m.before} → ${m.after} (${m.delta > 0 ? "+" : ""}${m.delta})`);
    }
  } else if (snap.played === 0) {
    lines.push(``, `📈 *Elo do ciclo*: nenhum jogo disputado ainda — ratings seguem os da Copa de 2026.`);
  }

  if (snap.upcoming.length) {
    lines.push(``, `📅 *Próximos jogos do ciclo*`);
    for (const { event: e, kind } of snap.upcoming) {
      lines.push(`• ${e.dateEvent.split("-").reverse().join("/")} ${e.strHomeTeam} x ${e.strAwayTeam} _(${KIND_LABEL[kind]})_`);
    }
  }
  return lines.join("\n");
}
