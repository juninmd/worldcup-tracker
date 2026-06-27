import type { Prediction, WcEvent } from "./types.ts";
import { canonicalTeam, rating, teamStrength } from "./elo.ts";
import { trainRatings } from "./elo.ts";
import { flag } from "./format.ts";
import { predictMatch } from "./predict.ts";
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
  groups: Map<string, ProjectedTeam[]>;
  qualifiers: ProjectedTeam[];
  knockout: ProjectedMatch[][];
  champion: string;
  brazilPath: ProjectedMatch[];
}

const num = (v: string | null | undefined) => Number(v ?? 0) || 0;

// A knockout fixture in the real feed (R32 → final). Group-stage events never match.
const KNOCKOUT_RE = /final|round of|quarter|semi|oitavas|quartas|16|32/i;
export function isKnockoutFixture(e: WcEvent): boolean {
  return KNOCKOUT_RE.test(e.strEvent) || KNOCKOUT_RE.test(e.strStatus ?? "");
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

// Official 2026 R32 bracket: adjacent groups cross-pair.
// 1st of group A faces 2nd of group B (and vice versa) in the same bracket section.
// Brazil (Group C) faces a team from Group D in R32.
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
      : predictMatch(table, e.strHomeTeam, e.strAwayTeam, events);
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

// Build the official 2026 R32 bracket using group-pair cross-seeding, then
// simulate subsequent rounds by pairing consecutive bracket winners.
function buildOfficialBracket(
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
    const pred = predictMatch(table, h, a, history, true); // neutral venue
    const real = realResult(h, a);
    if (real) {
      // Orient the real score to our (h, a) ordering and override the projection.
      const realHome = canonicalTeam(real.strHomeTeam) === canonicalTeam(h);
      const hs = num(realHome ? real.intHomeScore : real.intAwayScore);
      const as = num(realHome ? real.intAwayScore : real.intHomeScore);
      const realPred: Prediction = { ...pred, homeGoals: hs, awayGoals: as };
      // Decisive score → real winner; tie (decided on penalties, no shootout field
      // in the free feed) → fall back to the model's edge so a survivor still propagates.
      const win = hs > as ? h : as > hs ? a : winner(h, a, pred, table);
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

export async function tournamentProjection(): Promise<TournamentProjection> {
  const all = await mergedSeasonEvents();
  const table = trainRatings(all.filter(isFinished));
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
  const realKnockout = all.filter(isKnockoutFixture);
  const knockout = buildOfficialBracket(groups, thirds, table, all, realKnockout);
  const champion = knockout.at(-1)?.[0]?.winner ?? qualifiers[0]?.team ?? "indefinido";
  const brazilPath = brazilPathInKnockout(knockout);
  return { generatedAt: new Date().toISOString(), groups, qualifiers, knockout, champion, brazilPath };
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
    `_Modelo: ranking FIFA/Elo · resultados reais · qualidade do elenco · H2H_`,
    ``,
    `🏆 *Campeão previsto:* ${flag(p.champion)} *${p.champion}*`,
    ``,
  ];

  // ── Brazil's path ───────────────────────────────────────────────────────
  if (p.brazilPath.length) {
    lines.push(`🇧🇷 *CAMINHO DO BRASIL — projeção completa*`);
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
  lines.push(`*Fase de grupos — classificados esperados*`);
  for (const [g, rows] of p.groups) {
    const top3 = rows.slice(0, 3).map((r, i) => {
      const mark = i < 2 ? "🟢" : "🟡";
      return `${mark}${i + 1}. ${flag(r.team)} ${r.team} ${r.points}pts`;
    }).join("  ·  ");
    lines.push(`*Grupo ${g}:* ${top3}`);
  }
  lines.push(``);

  // ── Knockout bracket ────────────────────────────────────────────────────
  lines.push(`*Mata-mata — chaveamento*  _(✅ resultado real · 🔮 projeção)_`);
  for (const round of p.knockout) {
    const rName = round[0]?.round ?? "Rodada";
    lines.push(`\n*${rName}*`);
    const limit = rName === "Rodada de 32" ? 8 : round.length;
    for (const m of round.slice(0, limit)) {
      const tag = m.real ? "✅" : "🔮";
      lines.push(`  ${tag} ${flag(m.home)} ${m.home} ${m.prediction.homeGoals}×${m.prediction.awayGoals} ${m.away} ${flag(m.away)} → *${m.winner}*`);
    }
    if (rName === "Rodada de 32" && round.length > limit) {
      lines.push(`  _+${round.length - limit} partidas (imagem completa via /bracket)_`);
    }
  }

  return lines.join("\n");
}
