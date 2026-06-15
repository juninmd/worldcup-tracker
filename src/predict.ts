import type { Prediction } from "./types.ts";
import { expectancy, hostAdvantage, rating } from "./elo.ts";

const AVG_GOALS = 2.6; // typical total goals per WC match

function poisson(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (lambda ** k * Math.exp(-lambda)) / f;
}

/** Expected goals for each side, derived from Elo win-expectancy. */
function lambdas(eloHome: number, eloAway: number): [number, number] {
  const we = expectancy(eloHome + hostAdvantage(), eloAway);
  const lh = Math.max(0.3, AVG_GOALS * 0.5 + (we - 0.5) * 2.4);
  const la = Math.max(0.3, AVG_GOALS * 0.5 - (we - 0.5) * 2.4);
  return [lh, la];
}

/** Poisson scoreline + 1X2 probabilities for a fixture. */
export function predictMatch(
  table: Record<string, number>,
  home: string,
  away: string,
): Prediction {
  const eloHome = rating(table, home);
  const eloAway = rating(table, away);
  const [lh, la] = lambdas(eloHome, eloAway);

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
    eloHome: Math.round(eloHome),
    eloAway: Math.round(eloAway),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
