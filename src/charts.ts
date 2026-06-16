import type { Scorer } from "./scorers.ts";
import type { TableRow } from "./types.ts";
import { byGroup } from "./standings.ts";

// QuickChart renders Chart.js configs to a PNG with no API key — used to turn
// the standings/scorers tables into shareable card images.
const render = (config: unknown, w = 600, h = 400): string =>
  `https://quickchart.io/chart?w=${w}&h=${h}&bkg=white&c=${encodeURIComponent(JSON.stringify(config))}`;

const GREEN = "#16a34a";
const GREY = "#94a3b8";

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

/** Horizontal bar of points; teams currently qualifying (top 2 of their group)
 *  are highlighted green, the rest grey. */
export function standingsChartUrl(rows: TableRow[]): string | null {
  if (!rows.length) return null;
  const qualifying = new Set<string>();
  for (const list of byGroup(rows).values())
    for (const r of list.slice(0, 2)) qualifying.add(r.strTeam);

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
          backgroundColor: sorted.map((r) => (qualifying.has(r.strTeam) ? GREEN : GREY)),
        }],
      },
      options: {
        legend: { display: false },
        title: { display: true, text: "Classificação (pontos) — verde = zona de classificação", fontSize: 14 },
        scales: { xAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
      },
    },
    640,
    Math.max(260, sorted.length * 26 + 90),
  );
}
