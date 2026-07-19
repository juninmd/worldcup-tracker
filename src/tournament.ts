import type { Prediction, WcEvent } from "./types.ts";
import { canonicalTeam, FIFA_RANK_AS_OF, MODEL_VERSION, rating, teamStrength } from "./elo.ts";
import { trainRatings } from "./elo.ts";
import { flag } from "./format.ts";
import { calibrateGoals, predictMatch } from "./predict.ts";
import { squadAbsencePenalties } from "./injuries.ts";
import { isFinished, leagueTable, mergedSeasonEvents } from "./sportsdb.ts";

export interface ProjectedTeam {
  team: string;
  group: string;
  played: number;
  points: number;
  gf: number;
  ga: number;
}

export interface ProjectedMatch {
  round: string;
  home: string;
  away: string;
  prediction: Prediction;
  winner: string;
  real?: boolean; // true when score + winner come from a finished real match, not the model
}

export interface TournamentProjection {
  generatedAt: string;
  bracketSource?: "fifa" | "heuristic-fallback";
  groups: Map<string, ProjectedTeam[]>;
  qualifiers: ProjectedTeam[];
  knockout: ProjectedMatch[][];
  champion: string;
  brazilPath: ProjectedMatch[];
  // Third-place play-off (FIFA match 103). Kept OUT of `knockout` so it never
  // pollutes the bracket-tree wiring (chart edges pair rounds by index); surfaced
  // on its own, rendered right before the Final.
  thirdPlace?: ProjectedMatch;
}

// Likely-absent-regulars penalty per team (set once per projection run); makes
// every projected scoreline account for injured/suspended starters.
let absencePens = new Map<string, number>();
function predictWithAbsences(
  table: Record<string, number>,
  home: string,
  away: string,
  history: WcEvent[],
  neutral = true,
): Prediction {
  return predictMatch(table, home, away, history, neutral, {
    home: absencePens.get(canonicalTeam(home)) ?? 0,
    away: absencePens.get(canonicalTeam(away)) ?? 0,
  });
}

const num = (v: string | null | undefined) => Number(v ?? 0) || 0;
const matchNo = (e: WcEvent) => num(e.intRound);

// A knockout fixture in the real feed (R32 → final). Group-stage events never match.
const KNOCKOUT_RE = /final|round of|quarter|semi|oitavas|quartas|16|32/i;
export function isKnockoutFixture(e: WcEvent): boolean {
  return KNOCKOUT_RE.test(`${e.strStage ?? ""} ${e.strEvent} ${e.strStatus ?? ""}`);
}

// Official 2026 group draw. Source: FIFA/Al Jazeera schedule pages, June 2026.
export const WORLD_CUP_GROUPS: Record<string, string[]> = {
  A: ["Mexico", "South Africa", "Korea Republic", "Czech Republic"],
  B: ["Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland"],
  C: ["Brazil", "Morocco", "Haiti", "Scotland"],
  D: ["USA", "Paraguay", "Australia", "Turkey"],
  E: ["Germany", "Curacao", "Ivory Coast", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};

// Emergency heuristic only when FIFA publishes no knockout fixtures. The real
// 2026 allocation of best thirds has 495 combinations and must come from FIFA.
export const GROUP_BRACKET_PAIRS: [string, string][] = [
  ["A", "B"], ["C", "D"], ["E", "F"],
  ["G", "H"], ["I", "J"], ["K", "L"],
];

const GROUP_BY_TEAM = new Map(
  Object.entries(WORLD_CUP_GROUPS).flatMap(([g, teams]) => teams.map((t) => [canonicalTeam(t), g] as const)),
);

function groupName(e: WcEvent): string {
  const raw = e.strGroup?.trim();
  if (raw) return normalizeGroup(raw);
  const m = e.strEvent.match(/\bGroup\s+([A-L])\b/i);
  if (m?.[1]) return m[1].toUpperCase();
  const home = GROUP_BY_TEAM.get(canonicalTeam(e.strHomeTeam));
  const away = GROUP_BY_TEAM.get(canonicalTeam(e.strAwayTeam));
  return home && home === away ? home : "Projetado";
}

const normalizeGroup = (group: string): string => group.replace(/^Group\s+/i, "").toUpperCase();

function addTeam(groups: Map<string, Map<string, ProjectedTeam>>, group: string, team: string): ProjectedTeam {
  group = normalizeGroup(group);
  team = canonicalTeam(team);
  for (const [existingGroup, teams] of groups) {
    const existing = teams.get(team);
    if (existing && existingGroup !== "Projetado") return existing;
  }
  const g = groups.get(group) ?? new Map<string, ProjectedTeam>();
  groups.set(group, g);
  const row = g.get(team) ?? { team, group, played: 0, points: 0, gf: 0, ga: 0 };
  g.set(team, row);
  return row;
}

function applyScore(row: ProjectedTeam, gf: number, ga: number): void {
  row.played++;
  row.gf += gf;
  row.ga += ga;
  row.points += gf > ga ? 3 : gf === ga ? 1 : 0;
}

function sortRows(rows: ProjectedTeam[], table: Record<string, number>): ProjectedTeam[] {
  return rows.sort((a, b) =>
    b.points - a.points ||
    (b.gf - b.ga) - (a.gf - a.ga) ||
    b.gf - a.gf ||
    teamStrength(table, b.team) - teamStrength(table, a.team) ||
    a.team.localeCompare(b.team));
}

function winner(home: string, away: string, p: Prediction, table: Record<string, number>): string {
  if (p.homeGoals > p.awayGoals) return home;
  if (p.awayGoals > p.homeGoals) return away;
  if (p.pHome !== p.pAway) return p.pHome > p.pAway ? home : away;
  return teamStrength(table, home) >= teamStrength(table, away) ? home : away;
}

function realWinner(e: WcEvent, home: string, away: string, table: Record<string, number>, pred: Prediction): string {
  if (e.idWinnerTeam === e.idHomeTeam) return canonicalTeam(e.strHomeTeam);
  if (e.idWinnerTeam === e.idAwayTeam) return canonicalTeam(e.strAwayTeam);

  const hs = Number(e.intHomeScore);
  const as = Number(e.intAwayScore);
  if (hs > as) return canonicalTeam(e.strHomeTeam);
  if (as > hs) return canonicalTeam(e.strAwayTeam);

  const hps = Number(e.intHomePenaltyScore);
  const aps = Number(e.intAwayPenaltyScore);
  if (hps > aps) return canonicalTeam(e.strHomeTeam);
  if (aps > hps) return canonicalTeam(e.strAwayTeam);

  return winner(home, away, pred, table);
}

async function projectedGroups(events: WcEvent[], table: Record<string, number>): Promise<Map<string, ProjectedTeam[]>> {
  const rows = await leagueTable();
  const trustTable = rows.length >= 48;
  const groups = new Map<string, Map<string, ProjectedTeam>>();

  for (const r of trustTable ? rows : []) {
    const group = r.strGroup?.trim() ? normalizeGroup(r.strGroup) : "Projetado";
    const row = addTeam(groups, group, r.strTeam);
    row.played = num(r.intPlayed);
    row.points = num(r.intPoints);
    row.gf = num(r.intGoalsFor);
    row.ga = num(r.intGoalsAgainst);
  }

  for (const e of events) {
    const group = groupName(e);
    const home = addTeam(groups, group, e.strHomeTeam);
    const away = addTeam(groups, group, e.strAwayTeam);
    if (trustTable && home.played + away.played > 0 && isFinished(e)) continue;
    const p = isFinished(e)
      ? { homeGoals: num(e.intHomeScore), awayGoals: num(e.intAwayScore) }
      : predictWithAbsences(table, e.strHomeTeam, e.strAwayTeam, events);
    applyScore(home, p.homeGoals, p.awayGoals);
    applyScore(away, p.awayGoals, p.homeGoals);
  }

  return new Map([...groups.entries()]
    .map(([g, list]) => [g, sortRows([...list.values()], table)] as const)
    .sort((a, b) => a[0].localeCompare(b[0])));
}

function qualifiersFrom(groups: Map<string, ProjectedTeam[]>, table: Record<string, number>): ProjectedTeam[] {
  const firstSecond = [...groups.values()].flatMap((g) => g.slice(0, 2));
  const thirds = [...groups.values()].map((g) => g[2]).filter((x): x is ProjectedTeam => !!x);
  const seen = new Set<string>();
  return [
    ...firstSecond,
    ...sortRows(thirds, table).slice(0, 8),
  ].filter((q) => {
    if (seen.has(q.team)) return false;
    seen.add(q.team);
    return true;
  }).sort((a, b) =>
    b.points - a.points ||
    (b.gf - b.ga) - (a.gf - a.ga) ||
    teamStrength(table, b.team) - teamStrength(table, a.team));
}

function isKnockoutEvent(e: WcEvent): boolean {
  return /final|round of|quarter|semi|16|32/i.test(`${e.strStage ?? ""} ${e.strEvent}`);
}

export function knockoutRoundName(e: WcEvent): string | null {
  const stage = e.strStage ?? "";
  const text = `${stage} ${e.strEvent} ${e.strPlaceHolderA ?? ""} ${e.strPlaceHolderB ?? ""}`;
  const number = matchNo(e);
  if (number === 103 || /third[ -]?place|bronze|RU10[12]/i.test(text)) return null;
  if (number === 101 || number === 102) return "Semifinal";
  if (number === 104) return "Final";
  if (/round of 32/i.test(stage)) return "Rodada de 32";
  if (/round of 16/i.test(stage)) return "Oitavas";
  if (/quarter/i.test(stage)) return "Quartas";
  if (/semi/i.test(stage)) return "Semifinal";
  if (/final/i.test(stage)) return "Final";
  return stage || e.strEvent;
}

export function selectTournamentChampion(rounds: ProjectedMatch[][], fallback: string): string {
  const finals = rounds.flat().filter((match) => match.round === "Final");
  return finals.length === 1 ? finals[0]!.winner : fallback;
}

function resolveRankedPlaceholder(
  token: string | null | undefined,
  groups: Map<string, ProjectedTeam[]>,
  thirds: ProjectedTeam[],
  usedThirds: Set<string>,
): string | null {
  if (!token) return null;
  const ranked = token.match(/^([123])([A-L]+)$/i);
  if (!ranked) return null;
  const rank = Number(ranked[1]);
  const groupCodes = ranked[2]!.toUpperCase().split("");
  if (rank <= 2) return groups.get(groupCodes[0]!)?.[rank - 1]?.team ?? null;

  const candidate = thirds.find((t) => groupCodes.includes(t.group) && !usedThirds.has(t.team));
  if (!candidate) return null;
  usedThirds.add(candidate.team);
  return candidate.team;
}

function isPlaceholder(value: string | null | undefined): boolean {
  return /^(?:W|RU)?\d+$|^[123][A-L]+$/i.test(value ?? "");
}

function buildFifaBracket(
  events: WcEvent[],
  groups: Map<string, ProjectedTeam[]>,
  thirds: ProjectedTeam[],
  table: Record<string, number>,
  history: WcEvent[],
): ProjectedMatch[][] | null {
  const knockoutEvents = events
    .filter(isKnockoutEvent)
    .filter((e) => knockoutRoundName(e) !== null)
    .sort((a, b) => matchNo(a) - matchNo(b));
  if (!knockoutEvents.length) return null;

  const byRound = new Map<string, ProjectedMatch[]>();
  const winners = new Map<string, string>();
  const usedThirds = new Set<string>();

  const resolve = (side: "home" | "away", e: WcEvent): string => {
    const actual = side === "home" ? e.strHomeTeam : e.strAwayTeam;
    const explicit = side === "home" ? e.strPlaceHolderA : e.strPlaceHolderB;
    const token = explicit || actual;
    if (actual && actual !== "TBD" && !isPlaceholder(actual)) return canonicalTeam(actual);

    const win = token?.match(/^W(\d+)$/i);
    if (win) return winners.get(win[1]!) ?? token!;
    const ranked = resolveRankedPlaceholder(token, groups, thirds, usedThirds);
    return ranked ?? token ?? "TBD";
  };

  for (const e of knockoutEvents) {
    const home = resolve("home", e);
    const away = resolve("away", e);
    const round = knockoutRoundName(e)!;
    const predicted = predictWithAbsences(table, home, away, history);
    const hs = Number(e.intHomeScore);
    const as = Number(e.intAwayScore);
    const hasRealScore = !Number.isNaN(hs) && !Number.isNaN(as);
    const pred = isFinished(e) && hasRealScore
      ? { ...predicted, homeGoals: hs, awayGoals: as }
      : predicted;
    const win = isFinished(e) && hasRealScore ? realWinner(e, home, away, table, pred) : winner(home, away, pred, table);
    const projected: ProjectedMatch = { round, home, away, prediction: pred, winner: win, real: isFinished(e) && hasRealScore };
    (byRound.get(round) ?? byRound.set(round, []).get(round)!).push(projected);
    winners.set(String(matchNo(e)), projected.winner);
  }

  const order = ["Rodada de 32", "Oitavas", "Quartas", "Semifinal", "Final"];
  return order.map((name) => byRound.get(name) ?? []).filter((round) => round.length);
}

// Explicitly-labelled heuristic fallback; never presented as an official bracket.
function buildHeuristicBracket(
  groups: Map<string, ProjectedTeam[]>,
  thirds: ProjectedTeam[],
  table: Record<string, number>,
  history: WcEvent[],
  knockout: WcEvent[] = [],
): ProjectedMatch[][] {
  const getTeam = (g: string, pos: number): string =>
    groups.get(g)?.[pos]?.team ?? `?${g}${pos + 1}`;

  // Real finished knockout match between two teams (order-insensitive), if any.
  // This is what keeps the projected bracket honest: once a real R32/R16/… result
  // exists, its actual score + winner override the model and propagate forward,
  // because subsequent rounds pair the (now real) winners of the prior round.
  const realResult = (h: string, a: string): WcEvent | null => {
    const ch = canonicalTeam(h), ca = canonicalTeam(a);
    return knockout.find((e) => {
      if (!isFinished(e)) return false;
      const eh = canonicalTeam(e.strHomeTeam), ea = canonicalTeam(e.strAwayTeam);
      return (eh === ch && ea === ca) || (eh === ca && ea === ch);
    }) ?? null;
  };

  const makeMatch = (h: string, a: string, round: string): ProjectedMatch => {
    const pred = predictWithAbsences(table, h, a, history); // neutral venue
    const real = realResult(h, a);
    if (real) {
      // Orient the real score to our (h, a) ordering and override the projection.
      const realHome = canonicalTeam(real.strHomeTeam) === canonicalTeam(h);
      const hs = num(realHome ? real.intHomeScore : real.intAwayScore);
      const as = num(realHome ? real.intAwayScore : real.intHomeScore);
      const realPred: Prediction = { ...pred, homeGoals: hs, awayGoals: as };
      const win = realWinner(real, h, a, table, pred);
      return { round, home: h, away: a, prediction: realPred, winner: win, real: true };
    }
    return { round, home: h, away: a, prediction: pred, winner: winner(h, a, pred, table) };
  };

  // 12 R32 matches from the 24 direct qualifiers (cross-paired by adjacent groups)
  const r32: ProjectedMatch[] = [];
  for (const [gA, gB] of GROUP_BRACKET_PAIRS) {
    r32.push(makeMatch(getTeam(gA, 0), getTeam(gB, 1), "Rodada de 32")); // 1st-A vs 2nd-B
    r32.push(makeMatch(getTeam(gB, 0), getTeam(gA, 1), "Rodada de 32")); // 1st-B vs 2nd-A
  }
  // 4 R32 matches from the 8 best 3rd-place teams
  const thirdsRanked = [...thirds]
    .sort((a, b) => teamStrength(table, b.team) - teamStrength(table, a.team))
    .slice(0, 8);
  for (let i = 0; i < thirdsRanked.length - 1; i += 2) {
    r32.push(makeMatch(thirdsRanked[i]!.team, thirdsRanked[i + 1]!.team, "Rodada de 32"));
  }

  // Subsequent rounds: consecutive bracket slots pair up
  const rounds: ProjectedMatch[][] = [r32];
  const roundNames = ["Oitavas", "Quartas", "Semifinal", "Final"];
  let prev = r32.map((m) => m.winner);

  for (const rName of roundNames) {
    if (prev.length < 2) break;
    const matches: ProjectedMatch[] = [];
    const next: string[] = [];
    for (let i = 0; i + 1 < prev.length; i += 2) {
      const m = makeMatch(prev[i]!, prev[i + 1]!, rName);
      matches.push(m);
      next.push(m.winner);
    }
    if (prev.length % 2 === 1) next.push(prev[prev.length - 1]!);
    if (matches.length) rounds.push(matches);
    prev = next;
  }

  return rounds;
}

// Extract the matches in which Brazil (or the projected Brazilian survivor) participates.
function brazilPathInKnockout(rounds: ProjectedMatch[][]): ProjectedMatch[] {
  const path: ProjectedMatch[] = [];
  let tracked = "Brazil";
  for (const round of rounds) {
    const match = round.find((m) =>
      canonicalTeam(m.home) === tracked || canonicalTeam(m.away) === tracked,
    );
    if (!match) break;
    path.push(match);
    if (canonicalTeam(match.winner) !== tracked) break; // Brazil eliminated
  }
  return path;
}

// The bronze-medal match (FIFA match 103) between the two beaten semifinalists.
// Built only once both sides are real teams, so we never render "RU101 vs RU102".
function buildThirdPlace(
  events: WcEvent[],
  table: Record<string, number>,
  history: WcEvent[],
): ProjectedMatch | undefined {
  const e = events.find((ev) => {
    const text = `${ev.strStage ?? ""} ${ev.strEvent} ${ev.strPlaceHolderA ?? ""} ${ev.strPlaceHolderB ?? ""}`;
    return matchNo(ev) === 103 || /third[ -]?place|bronze|play-?off for third|RU10[12]/i.test(text);
  });
  if (!e) return undefined;
  if (isPlaceholder(e.strHomeTeam) || isPlaceholder(e.strAwayTeam)) return undefined;
  if (!e.strHomeTeam || e.strHomeTeam === "TBD" || !e.strAwayTeam || e.strAwayTeam === "TBD") return undefined;
  const home = canonicalTeam(e.strHomeTeam);
  const away = canonicalTeam(e.strAwayTeam);
  const predicted = predictWithAbsences(table, home, away, history);
  const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);
  const hasRealScore = !Number.isNaN(hs) && !Number.isNaN(as);
  const real = isFinished(e) && hasRealScore;
  const pred = real ? { ...predicted, homeGoals: hs, awayGoals: as } : predicted;
  const win = real ? realWinner(e, home, away, table, pred) : winner(home, away, pred, table);
  return { round: "Disputa de 3º lugar", home, away, prediction: pred, winner: win, real };
}

export async function tournamentProjection(): Promise<TournamentProjection> {
  const all = await mergedSeasonEvents();
  const finished = all.filter(isFinished);
  const table = trainRatings(finished);
  calibrateGoals(finished);
  absencePens = await squadAbsencePenalties(all).catch(() => new Map<string, number>());
  const groupEvents = all.filter((e) =>
    num(e.intRound) <= 1 &&
    groupName(e) !== "Projetado" &&
    !/final|round of|quarter|semi|16|32/i.test(e.strEvent));
  let groups = await projectedGroups(groupEvents.length ? groupEvents : all, table);
  let qualifiers = qualifiersFrom(groups, table);
  if (qualifiers.length < 32) {
    const fallback = fallbackGroupEvents();
    groups = await projectedGroups(mergeFixtures([...fallback, ...groupEvents]), table);
    qualifiers = qualifiersFrom(groups, table);
  }
  const thirds = [...groups.values()].map((g) => g[2]).filter((x): x is ProjectedTeam => !!x);
  const fifaBracket = buildFifaBracket(all, groups, thirds, table, all);
  const knockout = fifaBracket ?? buildHeuristicBracket(groups, thirds, table, all);
  const champion = selectTournamentChampion(knockout, qualifiers[0]?.team ?? "indefinido");
  const brazilPath = brazilPathInKnockout(knockout);
  const thirdPlace = buildThirdPlace(all, table, all);
  return {
    generatedAt: new Date().toISOString(), bracketSource: fifaBracket ? "fifa" : "heuristic-fallback",
    groups, qualifiers, knockout, champion, brazilPath, thirdPlace,
  };
}

function fixtureKey(e: WcEvent): string {
  const teams = [canonicalTeam(e.strHomeTeam), canonicalTeam(e.strAwayTeam)].sort().join("|");
  return `${groupName(e)}|${teams}`;
}

function mergeFixtures(events: WcEvent[]): WcEvent[] {
  const map = new Map<string, WcEvent>();
  for (const e of events) map.set(fixtureKey(e), e);
  return [...map.values()];
}

function fallbackGroupEvents(): WcEvent[] {
  const events: WcEvent[] = [];
  for (const [group, bucket] of Object.entries(WORLD_CUP_GROUPS)) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        events.push({
          idEvent: `fallback-${group}-${i}-${j}`,
          strEvent: `Group ${group}: ${bucket[i]} vs ${bucket[j]}`,
          dateEvent: "2026-06-11",
          strTimestamp: null,
          strStatus: "NS",
          strProgress: null,
          strHomeTeam: bucket[i]!,
          strAwayTeam: bucket[j]!,
          idHomeTeam: "",
          idAwayTeam: "",
          intHomeScore: null,
          intAwayScore: null,
          strVenue: null,
          strLeague: "FIFA World Cup",
          strGroup: group,
          intRound: "1",
        });
      }
    }
  }
  return events;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

// Visual probability bar: 10 chars, filled blocks vs light shade.
function probBar(p: number, width = 10): string {
  const filled = Math.round(p * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ── Surprises vs disappointments: pre-tournament FIFA seed vs how far a team
//    actually went in the knockout. Judged only from real results, so it stays
//    silent until enough of the bracket is decided. Scope = knockout stage.
const KO_DEPTH: Record<string, number> = {
  "Rodada de 32": 1, "Oitavas": 2, "Quartas": 3, "Semifinal": 4, "Final": 5,
};
const GOT_LABEL = ["fase de grupos", "Rodada de 32", "Oitavas", "Quartas", "Semifinal", "vice (final)", "campeão"];
const EXP_LABEL = ["", "Rodada de 32", "Oitavas", "Quartas", "Semifinal", "final"];
const expectedDepth = (rank: number): number => rank <= 2 ? 5 : rank <= 8 ? 4 : rank <= 16 ? 3 : rank <= 24 ? 2 : 1;

export function fmtTournamentSurprises(p: TournamentProjection): string | null {
  const realMatches = p.knockout.flat().filter((m) => m.real);
  if (realMatches.length < 4) return null; // too early to judge
  const bestRank = new Map<string, number>();
  const reached = new Map<string, number>();
  for (const m of realMatches) {
    const d = KO_DEPTH[m.round] ?? 0;
    for (const [team, rank] of [
      [canonicalTeam(m.home), m.prediction.fifaRankHome],
      [canonicalTeam(m.away), m.prediction.fifaRankAway],
    ] as const) {
      const advanced = canonicalTeam(m.winner) === team;
      reached.set(team, Math.min(6, Math.max(reached.get(team) ?? 0, advanced ? d + 1 : d)));
      if (rank !== undefined) {
        const cur = bestRank.get(team);
        if (cur === undefined || rank < cur) bestRank.set(team, rank);
      }
    }
  }
  const rows = [...reached.entries()].map(([team, got]) => {
    const rank = bestRank.get(team);
    const exp = rank ? expectedDepth(rank) : 1;
    return { team, got, exp, delta: got - exp, rank };
  });
  const surprises = rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta || (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 3);
  const flops = rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta || (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 3);
  if (!surprises.length && !flops.length) return null;
  const line = (r: (typeof rows)[number], emoji: string) =>
    `${emoji} ${flag(r.team)} *${r.team}*${r.rank ? ` (FIFA #${r.rank})` : ""} — chegou às *${GOT_LABEL[r.got]}*, esperado ~${EXP_LABEL[r.exp]}`;
  const out = [
    `📊 *SURPRESAS x DECEPÇÕES — mata-mata*`,
    `_Ranking FIFA (${FIFA_RANK_AS_OF}) pré-Copa vs. até onde cada seleção chegou de fato._`,
    ``,
  ];
  if (surprises.length) { out.push(`🚀 *Surpreenderam:*`, ...surprises.map((r) => line(r, "▲"))); }
  if (flops.length) { out.push(``, `💤 *Decepcionaram:*`, ...flops.map((r) => line(r, "▼"))); }
  return out.join("\n");
}

// One-line match summary showing score prediction + winner probability.
function matchLine(m: ProjectedMatch, perspective?: string): string {
  const isBrazilHome = perspective
    ? canonicalTeam(m.home) === canonicalTeam(perspective)
    : true;
  const pWin = isBrazilHome ? m.prediction.pHome : m.prediction.pAway;
  const score = `${m.prediction.homeGoals}×${m.prediction.awayGoals}`;
  return (
    `${flag(m.home)} ${m.home} ${score} ${m.away} ${flag(m.away)}` +
    ` → *${m.winner}* _(${pct(isBrazilHome ? m.prediction.pHome : m.prediction.pAway)} vitória)_`
  );
}

export function fmtTournamentProjection(p: TournamentProjection): string {
  const lines: string[] = [
    `🔥 *CHAVE PROJETADA — Copa 2026*`,
    `_Modelo interno ${MODEL_VERSION}: Elo treinado · ranking FIFA ${FIFA_RANK_AS_OF} · índice manual de elenco · resultados · desfalques_`,
    `_Fonte do chaveamento: ${p.bracketSource === "heuristic-fallback" ? "fallback heurístico (não oficial)" : "FIFA"}_`,
    ``,
    `🏆 *Campeão previsto:* ${flag(p.champion)} *${p.champion}*`,
    ``,
  ];

  // ── Brazil's path ───────────────────────────────────────────────────────
  if (p.brazilPath.length) {
    const lastBrazilMatch = p.brazilPath.at(-1);
    const eliminated = lastBrazilMatch?.real && canonicalTeam(lastBrazilMatch.winner) !== "Brazil";
    lines.push(eliminated
      ? `🇧🇷 *CAMPANHA DO BRASIL — encerrada nas ${lastBrazilMatch.round}*`
      : `🇧🇷 *CAMINHO DO BRASIL — projeção completa*`);
    for (const m of p.brazilPath) {
      const isBrazilHome = canonicalTeam(m.home) === "Brazil";
      const pBrazil = isBrazilHome ? m.prediction.pHome : m.prediction.pAway;
      const opponent = isBrazilHome ? m.away : m.home;
      const bGoals = isBrazilHome ? m.prediction.homeGoals : m.prediction.awayGoals;
      const oGoals = isBrazilHome ? m.prediction.awayGoals : m.prediction.homeGoals;
      const brazilWins = canonicalTeam(m.winner) === "Brazil";
      const rankOp = m.prediction.fifaRankHome !== undefined
        ? (isBrazilHome ? m.prediction.fifaRankAway : m.prediction.fifaRankHome)
        : undefined;
      const rankStr = rankOp ? ` (FIFA #${rankOp})` : "";
      const src = m.real ? "resultado real" : `${pct(pBrazil)} Brasil`;
      lines.push(
        `*${m.round}*${m.real ? " ✅" : ""}: ${flag("Brazil")} Brazil *${bGoals}×${oGoals}* ${opponent} ${flag(opponent)}${rankStr}` +
        `\n  ${probBar(pBrazil)} ${src} · ${brazilWins ? "✅ avança" : "❌ eliminado"}`,
      );
    }
    lines.push(``);
  }

  // ── Group standings ──────────────────────────────────────────────────────
  const groupsComplete = p.groups.size > 0 && [...p.groups.values()].every((rows) => rows.length === 4 && rows.every((row) => row.played >= 3));
  const qualified = new Set(p.qualifiers.map((row) => canonicalTeam(row.team)));
  lines.push(`*Fase de grupos — ${groupsComplete ? "classificação final" : "classificação projetada"}*`);
  for (const [g, rows] of p.groups) {
    const top3 = rows.slice(0, 3).map((r, i) => {
      const mark = qualified.has(canonicalTeam(r.team)) ? "🟢" : groupsComplete ? "❌" : i < 2 ? "🟢" : "🟡";
      return `${mark}${i + 1}. ${flag(r.team)} ${r.team} ${r.points}pts`;
    }).join("  ·  ");
    lines.push(`*Grupo ${g}:* ${top3}`);
  }
  lines.push(``);

  // ── Knockout bracket ────────────────────────────────────────────────────
  lines.push(`*Mata-mata — chaveamento*  _(✅ resultado real · 🔮 projeção)_`);
  for (const round of p.knockout) {
    const rName = round[0]?.round ?? "Rodada";
    // The bronze match is played before the final — surface it right here.
    if (rName === "Final" && p.thirdPlace) {
      const t = p.thirdPlace;
      const tag = t.real ? "✅" : "🔮";
      lines.push(`\n*🥉 Disputa de 3º lugar*`);
      lines.push(`  ${tag} ${flag(t.home)} ${t.home} ${t.prediction.homeGoals}×${t.prediction.awayGoals} ${t.away} ${flag(t.away)} → *${t.winner}* 🥉`);
    }
    lines.push(`\n*${rName}*`);
    const limit = rName === "Rodada de 32" ? 8 : round.length;
    for (const m of round.slice(0, limit)) {
      const tag = m.real ? "✅" : "🔮";
      const pens = !m.real && m.prediction.homeGoals === m.prediction.awayGoals ? " _(pên.)_" : "";
      lines.push(`  ${tag} ${flag(m.home)} ${m.home} ${m.prediction.homeGoals}×${m.prediction.awayGoals} ${m.away} ${flag(m.away)} → *${m.winner}*${pens}`);
    }
    if (rName === "Rodada de 32" && round.length > limit) {
      lines.push(`  _+${round.length - limit} partidas (imagem completa via /bracket)_`);
    }
  }

  return lines.join("\n");
}
