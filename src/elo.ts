import type { WcEvent, MatchOutcome } from "./types.ts";

// Seed strength prior (FIFA ranking/Elo-style, approx. 2026 field strength).
// FIFA official ranking reference: 2026-06-11. Finished matches update it below.
const SEED: Record<string, number> = {
  Argentina: 2140, France: 2100, Spain: 2080, England: 2060, Brazil: 2070,
  Portugal: 2010, Netherlands: 1995, Belgium: 1955, Germany: 1975, Italy: 1950,
  Croatia: 1920, Uruguay: 1915, Colombia: 1895, Morocco: 1890, Switzerland: 1850,
  Denmark: 1860, Japan: 1835, Senegal: 1835, "Korea Republic": 1790, Paraguay: 1760,
  Ecuador: 1820, Serbia: 1820, Poland: 1790, Australia: 1745, Canada: 1760,
  Nigeria: 1810, "Ivory Coast": 1790, Cameroon: 1760, Ghana: 1740, Egypt: 1815,
  Tunisia: 1740, Algeria: 1800, "Saudi Arabia": 1700, Iran: 1785, Qatar: 1680,
  Norway: 1905, Sweden: 1820, Austria: 1845, Turkey: 1835, Ukraine: 1820,
  Wales: 1780, Scotland: 1780, Peru: 1740, Chile: 1780, Venezuela: 1720,
  "Costa Rica": 1720, Panama: 1700, "New Zealand": 1620, "South Africa": 1720,
  USA: 1825, Mexico: 1815,
  "Czech Republic": 1770, "Bosnia and Herzegovina": 1715, Haiti: 1580,
  Curacao: 1660, "Cape Verde": 1710, Iraq: 1690, Jordan: 1665,
  "DR Congo": 1705, Uzbekistan: 1685,
};

const DEFAULT = 1500;
const HFA = 65; // home/host advantage in Elo points
const K = 30;

// Squad quality prior: compact estimate of elite-player depth/top-end talent.
// Kept separate from FIFA/Elo so messages can show both factors.
const PLAYER_QUALITY: Record<string, number> = {
  France: 58, England: 54, Brazil: 52, Spain: 50, Argentina: 48, Portugal: 47,
  Germany: 42, Netherlands: 40, Italy: 39, Belgium: 36, Morocco: 33,
  Uruguay: 32, Croatia: 30, Colombia: 29, Denmark: 27, Switzerland: 26,
  Norway: 26, Japan: 24, USA: 23, Senegal: 23, Ecuador: 22, Mexico: 22,
  Turkey: 21, Austria: 20, Sweden: 20, Serbia: 19, Poland: 18, Ukraine: 18,
  "Ivory Coast": 18, Nigeria: 18, Ghana: 17, Cameroon: 16, Egypt: 16,
  Paraguay: 15, Canada: 15, Australia: 14, "Korea Republic": 14,
  Algeria: 14, Scotland: 13, Wales: 13, Tunisia: 12, Iran: 12,
  "Saudi Arabia": 10, Qatar: 9, "Czech Republic": 17, "South Africa": 11,
  "Costa Rica": 10, Panama: 9, "New Zealand": 8, Peru: 13, Chile: 13,
  Venezuela: 12, "Bosnia and Herzegovina": 12, Haiti: 7, Curacao: 8,
  "Cape Verde": 9, Iraq: 8, Jordan: 7, "DR Congo": 12, Uzbekistan: 8,
};

export function canonicalTeam(name: string): string {
  return name
    .replace(/^(USA|United States).*/i, "USA")
    .replace(/^South Korea$/i, "Korea Republic")
    .replace(/^Czechia$/i, "Czech Republic")
    .replace(/^Bosnia$/i, "Bosnia and Herzegovina")
    .replace(/^Bosnia-Herzegovina$/i, "Bosnia and Herzegovina")
    .replace(/^Turkiye$/i, "Turkey")
    .replace(/^Türkiye$/i, "Turkey")
    .replace(/^DRC$/i, "DR Congo")
    .replace(/^Curaçao$/i, "Curacao")
    .trim();
}

export function rating(table: Record<string, number>, team: string): number {
  return table[canonicalTeam(team)] ?? table[team] ?? DEFAULT;
}

export function playerQuality(team: string): number {
  return PLAYER_QUALITY[canonicalTeam(team)] ?? 0;
}

export function teamStrength(table: Record<string, number>, team: string): number {
  return rating(table, team) + playerQuality(team);
}

export function hostAdvantage(): number {
  return HFA;
}

/** Expected score (win expectancy) for A vs B given Elo diff. */
export function expectancy(eloA: number, eloB: number): number {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

/** Build a rating table from seed, then "train" it on all finished results. */
export function trainRatings(finished: WcEvent[]): Record<string, number> {
  const table: Record<string, number> = { ...SEED };
  const sorted = [...finished].sort((a, b) =>
    (a.strTimestamp ?? a.dateEvent).localeCompare(b.strTimestamp ?? b.dateEvent),
  );
  for (const e of sorted) {
    const h = canonicalTeam(e.strHomeTeam), a = canonicalTeam(e.strAwayTeam);
    const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);
    if (Number.isNaN(hs) || Number.isNaN(as)) continue;
    const eh = table[h] ?? DEFAULT, ea = table[a] ?? DEFAULT;
    const we = expectancy(eh + HFA, ea);
    const sh = hs > as ? 1 : hs === as ? 0.5 : 0;
    const margin = 1 + Math.log(1 + Math.abs(hs - as)); // goal-diff weighting
    const delta = K * margin * (sh - we);
    table[h] = eh + delta;
    table[a] = ea - delta;
  }
  return table;
}

export function outcomeOf(e: WcEvent): MatchOutcome | null {
  const h = Number(e.intHomeScore), a = Number(e.intAwayScore);
  if (Number.isNaN(h) || Number.isNaN(a)) return null;
  return { home: h, away: a, result: h > a ? "H" : h === a ? "D" : "A" };
}

export function knownTeams(): string[] {
  return Object.keys(SEED);
}

// FIFA men's ranking positions (June 2026). Used for display + tie-breaking only;
// Elo/strength is the actual prediction input.
const FIFA_RANK: Record<string, number> = {
  Argentina: 1, France: 2, Spain: 3, England: 4, Brazil: 5,
  Portugal: 6, Netherlands: 7, Belgium: 8, Germany: 9, Uruguay: 10,
  Colombia: 11, Croatia: 12, Morocco: 13, USA: 14, Italy: 15,
  Switzerland: 16, Japan: 17, Denmark: 18, Senegal: 19, Turkey: 20,
  Austria: 21, "Korea Republic": 22, Norway: 23, Ecuador: 24, Nigeria: 25,
  Paraguay: 26, Mexico: 27, Egypt: 28, Algeria: 29, Iran: 30,
  Serbia: 31, Sweden: 32, Poland: 33, Ukraine: 34, "Ivory Coast": 35,
  Cameroon: 36, Tunisia: 37, Ghana: 38, Chile: 39, Peru: 40,
  Venezuela: 41, Canada: 42, Australia: 43, Scotland: 44, Wales: 45,
  "Czech Republic": 46, "Saudi Arabia": 47, "South Africa": 48,
  "Cape Verde": 49, "DR Congo": 50, Qatar: 51, Iraq: 52,
  "Bosnia and Herzegovina": 53, Jordan: 54, "Costa Rica": 55,
  Panama: 56, Uzbekistan: 57, Haiti: 58, Curacao: 59, "New Zealand": 60,
};

export function fifaRank(team: string): number | null {
  return FIFA_RANK[canonicalTeam(team)] ?? null;
}
