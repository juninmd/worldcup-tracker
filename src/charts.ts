import type { Scorer } from "./scorers.ts";
import type { CardTally } from "./cards.ts";
import type { TableRow, IntensityBucket } from "./types.ts";
import type { TournamentProjection } from "./tournament.ts";
import type { ChampionOdds } from "./champion.ts";
import { byGroup, qualificationStatuses } from "./standings.ts";

// QuickChart renders Chart.js configs to a PNG with no API key — used to turn
// the standings/scorers tables into shareable card images.
const render = (config: unknown, w = 600, h = 400): string =>
  `https://quickchart.io/chart?w=${w}&h=${h}&bkg=white&c=${encodeURIComponent(JSON.stringify(config))}`;

const GREEN = "#16a34a";
const GREY = "#94a3b8";
const BLUE = "#2563eb";
const AMBER = "#f59e0b";
const RED = "#dc2626";

/** Recent-form record for a team: last-N results, most recent first. */
export interface TeamForm {
  team: string;
  results: ("W" | "D" | "L")[];
}

/** A fixture's 1X2 probabilities, ready to chart as a 100% stacked bar. */
export interface FixtureOdds {
  label: string;
  pHome: number;
  pDraw: number;
  pAway: number;
}

/** Horizontal bar of the top scorers' goal counts. */
export function scorersChartUrl(list: Scorer[]): string | null {
  const top = list.slice(0, 12);
  if (!top.length) return null;
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: top.map((s) => `${s.player} (${s.team})`),
        datasets: [{ label: "Gols", data: top.map((s) => s.goals), backgroundColor: GREEN }],
      },
      options: {
        legend: { display: false },
        title: { display: true, text: "Artilharia — Copa do Mundo 2026", fontSize: 16 },
        scales: { xAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
      },
    },
    640,
    Math.max(220, top.length * 34 + 80),
  );
}

/** Horizontal bar of card counts (yellow + 2x red), most-carded players first. */
export function cardsChartUrl(list: CardTally[]): string | null {
  const top = list.slice(0, 12);
  if (!top.length) return null;
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: top.map((c) => `${c.player} (${c.team})`),
        datasets: [
          { label: "Amarelos", data: top.map((c) => c.yellow), backgroundColor: AMBER },
          { label: "Vermelhos", data: top.map((c) => c.red), backgroundColor: RED },
        ],
      },
      options: {
        title: { display: true, text: "Cartões — Copa do Mundo 2026", fontSize: 16 },
        scales: {
          xAxes: [{ stacked: true, ticks: { beginAtZero: true, precision: 0 } }],
          yAxes: [{ stacked: true }],
        },
      },
    },
    640,
    Math.max(220, top.length * 34 + 80),
  );
}

/** Grouped bar of match "intensity" (shots + corners + fouls + cards + goals) per
 *  15-minute period, home vs away — a temporal heat of the game, not a pitch heatmap
 *  (the free FIFA feed carries no player-position data). */
export function matchIntensityChartUrl(buckets: IntensityBucket[], home: string, away: string): string | null {
  if (!buckets.length || !buckets.some((b) => b.home || b.away)) return null;
  return render(
    {
      type: "bar",
      data: {
        labels: buckets.map((b) => `${b.label}'`),
        datasets: [
          { label: home, data: buckets.map((b) => b.home), backgroundColor: GREEN },
          { label: away, data: buckets.map((b) => b.away), backgroundColor: BLUE },
        ],
      },
      options: {
        title: { display: true, text: `Mapa de calor — intensidade por período: ${home} x ${away}`, fontSize: 14 },
        scales: { yAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
      },
    },
    660,
    320,
  );
}

/** Horizontal bar of points; direct qualifiers and qualified best thirds are green. */
export function standingsChartUrl(rows: TableRow[]): string | null {
  if (!rows.length) return null;
  const statuses = qualificationStatuses(rows);
  const provisionalTop = new Set<string>();
  for (const list of byGroup(rows).values()) for (const row of list.slice(0, 2)) provisionalTop.add(row.strTeam);

  const sorted = [...rows].sort(
    (a, b) => (Number(b.intPoints) || 0) - (Number(a.intPoints) || 0),
  );
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: sorted.map((r) => r.strTeam),
        datasets: [{
          label: "Pontos",
          data: sorted.map((r) => Number(r.intPoints) || 0),
          backgroundColor: sorted.map((r) => statuses.get(r.strTeam) === "qualified" || provisionalTop.has(r.strTeam)
            ? GREEN : statuses.get(r.strTeam) === "provisional" ? AMBER : GREY),
        }],
      },
      options: {
        legend: { display: false },
        title: { display: true, text: "Classificação — verde: classificado · amarelo: provisório", fontSize: 14 },
        scales: { xAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
      },
    },
    640,
    Math.max(260, sorted.length * 26 + 90),
  );
}

/** Horizontal bar of title-winning probability (%) for the top contenders. */
export function championChartUrl(odds: ChampionOdds[]): string | null {
  const top = odds.slice(0, 12);
  if (!top.length) return null;
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: top.map((o) => o.team),
        datasets: [{
          label: "Chance de título (%)",
          data: top.map((o) => Math.round(o.prob * 1000) / 10),
          backgroundColor: top.map((_, i) => (i === 0 ? GREEN : BLUE)),
        }],
      },
      options: {
        legend: { display: false },
        title: { display: true, text: "Favoritas ao título — Copa do Mundo 2026", fontSize: 16 },
        scales: { xAxes: [{ ticks: { beginAtZero: true } }] },
      },
    },
    640,
    Math.max(220, top.length * 32 + 80),
  );
}

/** Stacked horizontal bar: Elo base + bônus de elenco = força total. */
export function strengthChartUrl(odds: ChampionOdds[]): string | null {
  const top = [...odds].sort((a, b) => b.strength - a.strength).slice(0, 12);
  if (!top.length) return null;
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: top.map((o) => o.team),
        datasets: [
          { label: "Elo", data: top.map((o) => o.elo), backgroundColor: BLUE },
          { label: "Elenco", data: top.map((o) => o.playerQuality), backgroundColor: AMBER },
        ],
      },
      options: {
        title: { display: true, text: "Força das seleções — Elo + qualidade de elenco", fontSize: 15 },
        scales: { xAxes: [{ stacked: true, ticks: { beginAtZero: false } }], yAxes: [{ stacked: true }] },
      },
    },
    660,
    Math.max(240, top.length * 32 + 90),
  );
}

/** Stacked horizontal bar of last-N form: wins / draws / losses per team. */
export function formChartUrl(forms: TeamForm[]): string | null {
  const tally = (f: TeamForm, r: "W" | "D" | "L") => f.results.filter((x) => x === r).length;
  const ranked = [...forms]
    .filter((f) => f.results.length)
    .sort((a, b) => (tally(b, "W") * 3 + tally(b, "D")) - (tally(a, "W") * 3 + tally(a, "D")))
    .slice(0, 12);
  if (!ranked.length) return null;
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: ranked.map((f) => `${f.team} (${f.results.join("")})`),
        datasets: [
          { label: "V", data: ranked.map((f) => tally(f, "W")), backgroundColor: GREEN },
          { label: "E", data: ranked.map((f) => tally(f, "D")), backgroundColor: GREY },
          { label: "D", data: ranked.map((f) => tally(f, "L")), backgroundColor: RED },
        ],
      },
      options: {
        title: { display: true, text: "Forma recente — últimos jogos (V/E/D)", fontSize: 15 },
        scales: {
          xAxes: [{ stacked: true, ticks: { beginAtZero: true, precision: 0 } }],
          yAxes: [{ stacked: true }],
        },
      },
    },
    660,
    Math.max(240, ranked.length * 32 + 90),
  );
}

/** 100% stacked horizontal bar of 1X2 odds for each fixture. */
export function matchOddsChartUrl(fixtures: FixtureOdds[]): string | null {
  const list = fixtures.slice(0, 10);
  if (!list.length) return null;
  const pct = (p: number) => Math.round(p * 1000) / 10;
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: list.map((f) => f.label),
        datasets: [
          { label: "Casa", data: list.map((f) => pct(f.pHome)), backgroundColor: GREEN },
          { label: "Empate", data: list.map((f) => pct(f.pDraw)), backgroundColor: GREY },
          { label: "Fora", data: list.map((f) => pct(f.pAway)), backgroundColor: BLUE },
        ],
      },
      options: {
        title: { display: true, text: "Probabilidades dos jogos de hoje (%)", fontSize: 15 },
        scales: {
          xAxes: [{ stacked: true, ticks: { beginAtZero: true, max: 100 } }],
          yAxes: [{ stacked: true }],
        },
      },
    },
    660,
    Math.max(200, list.length * 38 + 80),
  );
}

/** Horizontal bar of Monte Carlo title probabilities (bracket-aware). */
export function simulationChartUrl(title: { team: string; prob: number }[], runs: number): string | null {
  const top = title.slice(0, 12);
  if (!top.length) return null;
  return render(
    {
      type: "horizontalBar",
      data: {
        labels: top.map((t) => t.team),
        datasets: [{
          label: "Título (%)",
          data: top.map((t) => Math.round(t.prob * 1000) / 10),
          backgroundColor: top.map((t, i) => (t.team === "Brazil" ? AMBER : i === 0 ? GREEN : BLUE)),
        }],
      },
      options: {
        legend: { display: false },
        title: { display: true, text: `Monte Carlo — título em ${runs.toLocaleString("pt-BR")} Copas simuladas (%)`, fontSize: 15 },
        scales: { xAxes: [{ ticks: { beginAtZero: true } }] },
      },
    },
    660,
    Math.max(220, top.length * 32 + 80),
  );
}

const graphviz = (dot: string, layout = "dot"): string =>
  `https://quickchart.io/graphviz?format=png&layout=${layout}&graph=${encodeURIComponent(dot)}`;

const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Circular bracket: champion at the center, each knockout round as a
 *  concentric ring (twopi layout) — final ring 1, semis ring 2, … R32 outermost. */
export function tournamentCircleChartUrl(p: TournamentProjection): string | null {
  if (!p.knockout.length) return null;
  const rounds = p.knockout;
  const last = rounds.length - 1;
  const lines = [
    "digraph G {",
    'graph [layout=twopi, root=champ, ranksep=2.2, overlap=false, splines=true, bgcolor=white];',
    'node [shape=ellipse, style=filled, fontname="Arial", fontsize=13, fillcolor="#eff6ff", color="#2563eb"];',
    'edge [color="#93c5fd", arrowhead=none];',
    `champ [label="CAMPEÃO\\n${esc(p.champion)}", shape=doublecircle, fillcolor="#fde68a", color="#f59e0b", fontsize=16];`,
  ];
  for (const [ri, round] of rounds.entries()) {
    for (const [mi, m] of round.entries()) {
      const hasBrazil = m.home === "Brazil" || m.away === "Brazil";
      // Brazil's matches pop in canarinho yellow/green; real results in soft green.
      const fill = hasBrazil ? "#fde047" : m.real ? "#dcfce7" : "#eff6ff";
      const border = hasBrazil ? ', color="#16a34a", penwidth=2' : "";
      const pens = !m.real && m.prediction.homeGoals === m.prediction.awayGoals ? " (pên.)" : "";
      const label = `${esc(m.home)} ${m.prediction.homeGoals}×${m.prediction.awayGoals} ${esc(m.away)}\\n${esc(m.winner)}${pens}`;
      lines.push(`m${ri}_${mi} [label="${label}", fillcolor="${fill}"${border}];`);
    }
  }
  lines.push(`champ -> m${last}_0;`);
  for (let ri = last; ri > 0; ri--) {
    const prev = rounds[ri - 1] ?? [];
    for (let mi = 0; mi < rounds[ri]!.length; mi++) {
      if (prev[mi * 2]) lines.push(`m${ri}_${mi} -> m${ri - 1}_${mi * 2};`);
      if (prev[mi * 2 + 1]) lines.push(`m${ri}_${mi} -> m${ri - 1}_${mi * 2 + 1};`);
    }
  }
  lines.push("}");
  return graphviz(lines.join("\n"), "twopi");
}

/** Daily tournament flame: bracket path + score predictions as shareable PNG. */
export function tournamentFlameChartUrl(p: TournamentProjection): string | null {
  if (!p.knockout.length) return null;
  const lines = [
    "digraph G {",
    "graph [rankdir=LR, bgcolor=white, pad=0.25, nodesep=0.35, ranksep=0.65];",
    'node [shape=box, style="rounded,filled", fontname="Arial", fontsize=16, color="#f97316", fillcolor="#fff7ed"];',
    'edge [color="#fb923c", arrowsize=0.7];',
    `title [shape=plain, label="🔥 Chama da Copa 2026\\nCampeão previsto: ${esc(p.champion)}"];`,
  ];
  for (const [ri, round] of p.knockout.entries()) {
    lines.push(`{ rank=same; r${ri} [shape=plain, label="${esc(round[0]?.round ?? "Rodada")}"];`);
    for (const [mi, m] of round.entries()) {
      const fill = m.winner === p.champion ? "#fee2e2" : "#fff7ed";
      const label = `${m.home} ${m.prediction.homeGoals} x ${m.prediction.awayGoals} ${m.away}\\n→ ${m.winner}`;
      lines.push(`m${ri}_${mi} [label="${esc(label)}", fillcolor="${fill}"];`);
    }
    lines.push("}");
  }
  lines.push("title -> m0_0 [style=invis];");
  for (let ri = 0; ri < p.knockout.length - 1; ri++) {
    const next = p.knockout[ri + 1] ?? [];
    for (let mi = 0; mi < next.length; mi++) {
      lines.push(`m${ri}_${mi * 2} -> m${ri + 1}_${mi};`);
      lines.push(`m${ri}_${mi * 2 + 1} -> m${ri + 1}_${mi};`);
    }
  }
  lines.push("}");
  return graphviz(lines.join("\n"));
}
