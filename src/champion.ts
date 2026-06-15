import { rating } from "./elo.ts";

export interface ChampionOdds {
  team: string;
  elo: number;
  prob: number;
}

/**
 * Champion forecast: softmax over Elo strength of the teams in the tournament.
 * Temperature tuned so the field stays competitive (no single runaway favorite).
 */
export function championForecast(
  table: Record<string, number>,
  teams: string[],
): ChampionOdds[] {
  const uniq = [...new Set(teams)].filter(Boolean);
  const T = 90; // softmax temperature in Elo points
  const scored = uniq.map((t) => ({ team: t, elo: Math.round(rating(table, t)) }));
  const max = Math.max(...scored.map((s) => s.elo));
  const exps = scored.map((s) => ({ ...s, w: Math.exp((s.elo - max) / T) }));
  const sum = exps.reduce((a, b) => a + b.w, 0);
  return exps
    .map((s) => ({ team: s.team, elo: s.elo, prob: s.w / sum }))
    .sort((a, b) => b.prob - a.prob);
}
