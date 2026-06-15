import type { WcEvent, MatchOutcome } from "./types.ts";

// Seed Elo ratings (World-Football-Elo style, approx. 2026 strength).
// Used as the prior for predictions; updated after every finished match below.
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
};

const DEFAULT = 1500;
const HFA = 65; // home/host advantage in Elo points
const K = 30;

function norm(name: string): string {
  return name.replace(/^(USA|United States).*/i, "USA").trim();
}

export function rating(table: Record<string, number>, team: string): number {
  return table[norm(team)] ?? table[team] ?? DEFAULT;
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
    const h = norm(e.strHomeTeam), a = norm(e.strAwayTeam);
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
