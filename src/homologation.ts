import { tournamentFlameChartUrl } from "./charts.ts";
import { sendPhoto } from "./telegram.ts";
import { tournamentProjection } from "./tournament.ts";

export interface HomologationResult {
  groups: number;
  qualifiers: number;
  rounds: number[];
  champion: string;
  chartStatus: number;
  chartContentType: string;
  chartBytes: number;
  problems: string[];
}

export async function homologateForecast(send = false): Promise<HomologationResult> {
  const projection = await tournamentProjection();
  const problems: string[] = [];
  const rounds = projection.knockout.map((r) => r.length);

  if (projection.groups.size !== 12) problems.push(`expected 12 groups, got ${projection.groups.size}`);
  if (projection.qualifiers.length !== 32) problems.push(`expected 32 qualifiers, got ${projection.qualifiers.length}`);
  if (rounds.join(",") !== "16,8,4,2,1") problems.push(`expected knockout 16,8,4,2,1, got ${rounds.join(",")}`);
  for (const [group, rows] of projection.groups) {
    if (rows.length !== 4) problems.push(`group ${group} has ${rows.length} teams`);
    for (const row of rows) {
      if (row.played > 3) problems.push(`${row.team} has ${row.played} group matches`);
      if (row.points > 9) problems.push(`${row.team} has ${row.points} group points`);
    }
  }

  const chart = tournamentFlameChartUrl(projection);
  if (!chart) problems.push("missing chart URL");
  const res = chart ? await fetch(chart, { method: "HEAD" }) : null;
  const chartStatus = res?.status ?? 0;
  const chartContentType = res?.headers.get("content-type") ?? "";
  const chartBytes = Number(res?.headers.get("content-length") ?? 0);
  if (chartStatus !== 200) problems.push(`chart status ${chartStatus}`);
  if (!chartContentType.includes("image/png")) problems.push(`chart content-type ${chartContentType}`);
  if (chartBytes < 10_000) problems.push(`chart too small: ${chartBytes} bytes`);

  if (send && chart) await sendPhoto(chart, `🔥 Homologação da Chama da Copa 2026 — ${projection.champion}`);

  return {
    groups: projection.groups.size,
    qualifiers: projection.qualifiers.length,
    rounds,
    champion: projection.champion,
    chartStatus,
    chartContentType,
    chartBytes,
    problems,
  };
}
