import type { Prediction, WcEvent } from "./types.ts";
import { canonicalTeam, expectancy, fifaRank, hostAdvantage, playerQuality, teamStrength } from "./elo.ts";

const AVG_GOALS = 2.6; // typical total goals per WC match

function poisson(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (lambda ** k * Math.exp(-lambda)) / f;
}

/** Expected goals for each side, derived from Elo win-expectancy. */
function lambdas(eloHome: number, eloAway: number, neutral = false): [number, number] {
  const hfa = neutral ? 0 : hostAdvantage();
  const we = expectancy(eloHome + hfa, eloAway);
  const lh = Math.max(0.3, AVG_GOALS * 0.5 + (we - 0.5) * 2.4);
  const la = Math.max(0.3, AVG_GOALS * 0.5 - (we - 0.5) * 2.4);
  return [lh, la];
}

/** Poisson scoreline + 1X2 probabilities for a fixture.
 *  neutral=true skips home-field advantage (knockout/neutral-venue games). */
export function predictMatch(
  table: Record<string, number>,
  home: string,
  away: string,
  history: WcEvent[] = [],
  neutral = false,
): Prediction {
  const bias = h2hBias(home, away, history);
  const qh = playerQuality(home), qa = playerQuality(away);
  const strengthHome = teamStrength(table, home) + bias;
  const strengthAway = teamStrength(table, away) - bias;
  const [lh, la] = lambdas(strengthHome, strengthAway, neutral);

  let pHome = 0, pDraw = 0, pAway = 0;
  let best = -1, bh = 0, ba = 0;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = poisson(lh, i) * poisson(la, j);
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (p > best) { best = p; bh = i; ba = j; }
    }
  }
  return {
    homeGoals: bh,
    awayGoals: ba,
    pHome: round(pHome),
    pDraw: round(pDraw),
    pAway: round(pAway),
    eloHome: Math.round(strengthHome - qh),
    eloAway: Math.round(strengthAway - qa),
    playerQualityHome: qh,
    playerQualityAway: qa,
    strengthHome: Math.round(strengthHome),
    strengthAway: Math.round(strengthAway),
    fifaRankHome: fifaRank(home) ?? undefined,
    fifaRankAway: fifaRank(away) ?? undefined,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function h2hBias(home: string, away: string, history: WcEvent[]): number {
  const h = canonicalTeam(home).toLowerCase(), a = canonicalTeam(away).toLowerCase();
  const meetings = history
    .filter((e) => {
      const eh = canonicalTeam(e.strHomeTeam).toLowerCase(), ea = canonicalTeam(e.strAwayTeam).toLowerCase();
      return ((eh === h && ea === a) || (eh === a && ea === h)) &&
        e.intHomeScore !== null && e.intAwayScore !== null;
    })
    .sort((x, y) => (y.strTimestamp ?? y.dateEvent).localeCompare(x.strTimestamp ?? x.dateEvent))
    .slice(0, 10);
  if (!meetings.length) return 0;
  const score = meetings.reduce((sum, e) => {
    const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);
    if (Number.isNaN(hs) || Number.isNaN(as) || hs === as) return sum;
    const winner = canonicalTeam(hs > as ? e.strHomeTeam : e.strAwayTeam).toLowerCase();
    return sum + (winner === h ? 1 : -1);
  }, 0);
  return Math.max(-35, Math.min(35, (score / meetings.length) * 35));
}
