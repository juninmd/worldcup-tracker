import type { Prediction, WcEvent } from "./types.ts";
import { canonicalTeam, expectancy, fifaRank, hostAdvantage, injuryPenalty, playerQuality, teamStrength } from "./elo.ts";

const AVG_GOALS = 2.6; // typical total goals per WC match

function poisson(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (lambda ** k * Math.exp(-lambda)) / f;
}

/** Expected goals for each side, derived from Elo difference.
 *  Log-linear split (softer curve than raw win-expectancy) avoids the old
 *  linear mapping's tendency to overshoot goal counts in lopsided ties, and
 *  mismatches inflate the total slightly (blowouts produce more goals). */
function lambdas(eloHome: number, eloAway: number, neutral = false): [number, number] {
  const hfa = neutral ? 0 : hostAdvantage();
  const diff = eloHome + hfa - eloAway;
  const total = AVG_GOALS * (1 + Math.min(0.35, Math.abs(diff) / 1200));
  const share = 1 / (1 + 10 ** (-diff / 480));
  const lh = Math.max(0.25, total * share);
  const la = Math.max(0.25, total * (1 - share));
  return [lh, la];
}

// Dixon-Coles low-score correlation: independent Poissons underrate 0-0/1-1
// and overrate 1-0/0-1. Standard rho correction, renormalized afterwards.
const RHO = -0.13;
function tau(i: number, j: number, lh: number, la: number): number {
  if (i === 0 && j === 0) return 1 - lh * la * RHO;
  if (i === 0 && j === 1) return 1 + lh * RHO;
  if (i === 1 && j === 0) return 1 + la * RHO;
  if (i === 1 && j === 1) return 1 - RHO;
  return 1;
}

/** Poisson scoreline + 1X2 probabilities for a fixture.
 *  All WC 2026 matches are on neutral ground — default neutral=true.
 *  lineupPen carries confirmed-lineup absence penalties (from injuries.ts);
 *  stacks on top of the static injuryPenalty() already in teamStrength(). */
export function predictMatch(
  table: Record<string, number>,
  home: string,
  away: string,
  history: WcEvent[] = [],
  neutral = true,
  lineupPen?: { home: number; away: number },
): Prediction {
  const bias = h2hBias(home, away, history);
  const penH = lineupPen?.home ?? 0;
  const penA = lineupPen?.away ?? 0;
  // Effective player quality: base − static absence − confirmed lineup absence
  const qh = Math.max(0, playerQuality(home) - injuryPenalty(home) - penH);
  const qa = Math.max(0, playerQuality(away) - injuryPenalty(away) - penA);
  const strengthHome = teamStrength(table, home) + bias - penH;
  const strengthAway = teamStrength(table, away) - bias - penA;
  const [lh, la] = lambdas(strengthHome, strengthAway, neutral);

  let pHome = 0, pDraw = 0, pAway = 0, total = 0;
  let best = -1, bh = 0, ba = 0;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = poisson(lh, i) * poisson(la, j) * tau(i, j, lh, la);
      total += p;
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (p > best) { best = p; bh = i; ba = j; }
    }
  }
  return {
    homeGoals: bh,
    awayGoals: ba,
    pHome: round(pHome / total),
    pDraw: round(pDraw / total),
    pAway: round(pAway / total),
    eloHome: Math.round(strengthHome - qh),
    eloAway: Math.round(strengthAway - qa),
    playerQualityHome: Math.round(qh),
    playerQualityAway: Math.round(qa),
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
