import type { WcEvent } from "./types.ts";
import type { TournamentProjection } from "./tournament.ts";
import { canonicalTeam } from "./elo.ts";
import { scoreMatrix } from "./predict.ts";

export interface SimTeamOdds {
  team: string;
  prob: number; // chance of winning the title
}

export interface SimResult {
  runs: number;
  title: SimTeamOdds[]; // desc by prob
  // Per-round survival for one tracked team: prob of reaching each stage.
  brazilFunnel: { stage: string; prob: number }[];
  // Most frequent title matchups across all runs, desc by prob.
  finals: { label: string; prob: number }[];
}

// Deterministic PRNG so simulations are reproducible (and testable).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pairKey = (a: string, b: string) =>
  [canonicalTeam(a), canonicalTeam(b)].sort().join("|");

const STAGES = ["Oitavas", "Quartas", "Semifinal", "Final", "Título"];

/** Monte Carlo over the projected R32 bracket: every knockout match is sampled
 *  from the model's 1X2 probabilities (draw → penalty coin flip), real results
 *  stay locked. Unlike the softmax forecast, this respects the bracket — a team
 *  on the champion's side of the draw wins less often than raw strength implies. */
export function simulateKnockout(
  projection: TournamentProjection,
  table: Record<string, number>,
  history: WcEvent[] = [],
  runs = 3000,
  seed = 20260711,
): SimResult | null {
  const r32 = projection.knockout[0];
  if (!r32?.length) return null;
  const rand = mulberry32(seed);

  // Real (finished) knockout results are facts — lock their winners.
  const realWinners = new Map<string, string>();
  for (const round of projection.knockout) {
    for (const m of round) if (m.real) realWinners.set(pairKey(m.home, m.away), canonicalTeam(m.winner));
  }

  // Cumulative scoreline distribution per pairing, memoized across runs.
  // Sampling the full DC-corrected score matrix (not a win/lose coin) keeps
  // draw frequency — and thus penalty lotteries — faithful to the model.
  const cumCache = new Map<string, number[]>();
  const cumFor = (home: string, away: string): number[] => {
    const key = `${canonicalTeam(home)}>${canonicalTeam(away)}`;
    let cum = cumCache.get(key);
    if (!cum) {
      const flat = scoreMatrix(table, home, away, history, true).flat();
      cum = [];
      let acc = 0;
      for (const p of flat) cum.push(acc += p);
      cumCache.set(key, cum);
    }
    return cum;
  };

  // Sample a scoreline; regulation draw → penalties ≈ coin flip.
  const playMatch = (home: string, away: string): string => {
    const cum = cumFor(home, away);
    const r = rand() * cum[cum.length - 1]!;
    let cell = cum.findIndex((c) => r < c);
    if (cell < 0) cell = cum.length - 1;
    const hg = Math.floor(cell / 9), ag = cell % 9;
    if (hg > ag) return canonicalTeam(home);
    if (ag > hg) return canonicalTeam(away);
    return rand() < 0.5 ? canonicalTeam(home) : canonicalTeam(away);
  };

  const titleCounts = new Map<string, number>();
  const finalCounts = new Map<string, number>();
  const brazilCounts = new Array(STAGES.length).fill(0);

  for (let run = 0; run < runs; run++) {
    let alive = r32.map((m) => realWinners.get(pairKey(m.home, m.away)) ?? playMatch(m.home, m.away));
    // R32 winners reached Oitavas; each later round survived bumps the stage.
    for (let stage = 0; stage < STAGES.length; stage++) {
      if (alive.includes("Brazil")) brazilCounts[stage]++;
      if (alive.length === 2) {
        const label = [...alive].sort().join(" x ");
        finalCounts.set(label, (finalCounts.get(label) ?? 0) + 1);
      }
      if (alive.length <= 1) {
        for (let s = stage + 1; s < STAGES.length; s++) if (alive.includes("Brazil")) brazilCounts[s]++;
        break;
      }
      const next: string[] = [];
      for (let i = 0; i + 1 < alive.length; i += 2) {
        const [h, a] = [alive[i]!, alive[i + 1]!];
        next.push(realWinners.get(pairKey(h, a)) ?? playMatch(h, a));
      }
      if (alive.length % 2 === 1) next.push(alive[alive.length - 1]!);
      alive = next;
    }
    const champ = alive[0]!;
    titleCounts.set(champ, (titleCounts.get(champ) ?? 0) + 1);
  }

  const title = [...titleCounts.entries()]
    .map(([team, n]) => ({ team, prob: n / runs }))
    .sort((a, b) => b.prob - a.prob);
  const brazilFunnel = STAGES.map((stage, i) => ({ stage, prob: brazilCounts[i]! / runs }));
  const finals = [...finalCounts.entries()]
    .map(([label, n]) => ({ label, prob: n / runs }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 5);
  return { runs, title, brazilFunnel, finals };
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export function fmtSimulation(sim: SimResult): string {
  const lines = [
    `🎲 *MONTE CARLO — ${sim.runs.toLocaleString("pt-BR")} Copas simuladas*`,
    `_Cada mata-mata sorteado jogo a jogo pelo modelo (empate → pênaltis na moeda)_`,
    ``,
    `*Chances de título:*`,
  ];
  for (const [i, t] of sim.title.slice(0, 8).entries()) {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "▪️";
    lines.push(`${medal} ${t.team} — *${pct(t.prob)}*`);
  }
  if (sim.finals.length) {
    lines.push(``, `🏟 *Finais mais prováveis:*`);
    for (const f of sim.finals.slice(0, 3)) lines.push(`• ${f.label} — ${pct(f.prob)}`);
  }
  if (sim.brazilFunnel.some((f) => f.prob > 0)) {
    lines.push(``, `🇧🇷 *Funil do Brasil:*`);
    lines.push(sim.brazilFunnel.map((f) => `${f.stage} ${pct(f.prob)}`).join(" → "));
  }
  return lines.join("\n");
}
