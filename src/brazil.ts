import { canonicalTeam } from "./elo.ts";
import { cardEvents, eventStats, isFinished, lineup, mergedSeasonEvents, shotEvents, timeline, type ShotEvent } from "./sportsdb.ts";
import type { CardEvent, TimelineItem, WcEvent } from "./types.ts";

export interface BrazilMatchMetricInput {
  event: WcEvent;
  shots: ShotEvent[];
  cards: CardEvent[];
  goals: TimelineItem[];
  starters: string[];
  cornersHome: number;
  cornersAway: number;
}

export interface BrazilMetrics {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number;
  xgAgainst: number;
  shotsFor: number;
  shotsAgainst: number;
  shotsOnTargetFor: number;
  shotsOnTargetAgainst: number;
  conversion: number | null;
  clearChancesFor: number;
  clearChancesAgainst: number;
  cornersFor: number;
  cornersAgainst: number;
  yellowPer90: number;
  redPer90: number;
  leadingMinutes: number;
  drawingMinutes: number;
  trailingMinutes: number;
  timelineCoverage: number;
  lineupCoverage: number;
  lineupContinuity: number | null;
  goalsForByPeriod: Record<string, number>;
  goalsAgainstByPeriod: Record<string, number>;
}

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));
const isBrazil = (team: string | null | undefined): boolean => canonicalTeam(team ?? "") === "Brazil";
const onTarget = (shot: ShotEvent): boolean => shot.outcome === "goal" || shot.outcome === "saved";
const period = (minute: string): string => {
  const value = Number.parseInt(minute, 10) || 0;
  if (value <= 15) return "0-15";
  if (value <= 30) return "16-30";
  if (value <= 45) return "31-45+";
  if (value <= 60) return "46-60";
  if (value <= 75) return "61-75";
  return "76-90+";
};

function scoreFromBrazil(event: WcEvent): [number, number] {
  const home = isBrazil(event.strHomeTeam);
  return home
    ? [Number(event.intHomeScore), Number(event.intAwayScore)]
    : [Number(event.intAwayScore), Number(event.intHomeScore)];
}

function addStateMinutes(input: BrazilMatchMetricInput, result: BrazilMetrics): void {
  const [actualFor, actualAgainst] = scoreFromBrazil(input.event);
  const goals = input.goals
    .filter((goal) => /goal/i.test(goal.strTimeline) && !/missed|disallow/i.test(goal.strTimelineDetail ?? ""))
    .sort((a, b) => Number(a.intTime) - Number(b.intTime));
  if (goals.length < actualFor + actualAgainst) return;
  result.timelineCoverage++;
  let last = 0, own = 0, opponent = 0;
  const add = (minutes: number) => {
    if (own > opponent) result.leadingMinutes += minutes;
    else if (own < opponent) result.trailingMinutes += minutes;
    else result.drawingMinutes += minutes;
  };
  for (const goal of goals) {
    const minute = Math.max(last, Math.min(90, Number.parseInt(goal.intTime, 10) || last));
    add(minute - last);
    if (isBrazil(goal.strTeam)) own++; else opponent++;
    const bucket = period(goal.intTime);
    const target = isBrazil(goal.strTeam) ? result.goalsForByPeriod : result.goalsAgainstByPeriod;
    target[bucket] = (target[bucket] ?? 0) + 1;
    last = minute;
  }
  add(90 - last);
}

export function calculateBrazilMetrics(inputs: BrazilMatchMetricInput[]): BrazilMetrics {
  const result: BrazilMetrics = {
    played: inputs.length, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0,
    xgFor: 0, xgAgainst: 0, shotsFor: 0, shotsAgainst: 0, shotsOnTargetFor: 0, shotsOnTargetAgainst: 0,
    conversion: null, clearChancesFor: 0, clearChancesAgainst: 0, cornersFor: 0, cornersAgainst: 0,
    yellowPer90: 0, redPer90: 0, leadingMinutes: 0, drawingMinutes: 0, trailingMinutes: 0,
    timelineCoverage: 0, lineupCoverage: 0, lineupContinuity: null,
    goalsForByPeriod: {}, goalsAgainstByPeriod: {},
  };
  let yellow = 0, red = 0;
  const lineups: string[][] = [];
  for (const input of inputs) {
    const [gf, ga] = scoreFromBrazil(input.event);
    result.goalsFor += gf;
    result.goalsAgainst += ga;
    if (gf > ga) result.wins++; else if (gf === ga) result.draws++; else result.losses++;
    const home = isBrazil(input.event.strHomeTeam);
    result.cornersFor += home ? input.cornersHome : input.cornersAway;
    result.cornersAgainst += home ? input.cornersAway : input.cornersHome;
    for (const shot of input.shots) {
      const own = isBrazil(shot.team);
      if (own) {
        result.shotsFor++;
        result.xgFor += shot.xg;
        if (onTarget(shot)) result.shotsOnTargetFor++;
        if (shot.clearChance) result.clearChancesFor++;
      } else {
        result.shotsAgainst++;
        result.xgAgainst += shot.xg;
        if (onTarget(shot)) result.shotsOnTargetAgainst++;
        if (shot.clearChance) result.clearChancesAgainst++;
      }
    }
    for (const card of input.cards.filter((card) => isBrazil(card.strTeam))) {
      if (card.cardType === "red") red++; else yellow++;
    }
    if (input.starters.length) lineups.push(input.starters);
    addStateMinutes(input, result);
  }
  result.xgFor = round(result.xgFor);
  result.xgAgainst = round(result.xgAgainst);
  result.conversion = result.shotsFor ? round(result.goalsFor / result.shotsFor, 4) : null;
  result.yellowPer90 = result.played ? round(yellow / result.played) : 0;
  result.redPer90 = result.played ? round(red / result.played) : 0;
  result.lineupCoverage = result.played ? round(lineups.length / result.played, 4) : 0;
  if (lineups.length >= 2) {
    const continuity: number[] = [];
    for (let index = 1; index < lineups.length; index++) {
      const previous = new Set(lineups[index - 1]);
      continuity.push(lineups[index]!.filter((player) => previous.has(player)).length / Math.max(previous.size, lineups[index]!.length));
    }
    result.lineupContinuity = round(continuity.reduce((sum, value) => sum + value, 0) / continuity.length, 4);
  }
  return result;
}

const statNumber = (value: string | null): number => Number.parseFloat(value ?? "0") || 0;

export async function brazilMetrics(): Promise<BrazilMetrics> {
  const matches = (await mergedSeasonEvents())
    .filter(isFinished)
    .filter((event) => isBrazil(event.strHomeTeam) || isBrazil(event.strAwayTeam))
    .sort((a, b) => (a.strTimestamp ?? a.dateEvent).localeCompare(b.strTimestamp ?? b.dateEvent));
  const inputs = await Promise.all(matches.map(async (event): Promise<BrazilMatchMetricInput> => {
    const [shots, cards, goals, stats, players] = await Promise.all([
      shotEvents(event.idEvent), cardEvents(event.idEvent), timeline(event.idEvent), eventStats(event.idEvent), lineup(event.idEvent),
    ]);
    const corners = stats.find((stat) => /corner/i.test(stat.strStat));
    const brazilHome = isBrazil(event.strHomeTeam);
    const starters = players.filter((player) =>
      (player.strSubstitute ?? "").toLowerCase() !== "yes" &&
      ((player.strHome ?? "").toLowerCase() === "yes") === brazilHome).map((player) => player.strPlayer);
    return {
      event, shots, cards, goals, starters,
      cornersHome: statNumber(corners?.intHome ?? null), cornersAway: statNumber(corners?.intAway ?? null),
    };
  }));
  return calculateBrazilMetrics(inputs);
}

const pct = (value: number | null): string => value === null ? "n/d" : `${(value * 100).toFixed(1)}%`;
const periods = (values: Record<string, number>): string =>
  ["0-15", "16-30", "31-45+", "46-60", "61-75", "76-90+"].map((key) => `${key}: ${values[key] ?? 0}`).join(" · ");

export function fmtBrazilMetrics(metrics: BrazilMetrics): string {
  if (!metrics.played) return "🇧🇷 *RAIO-X DO BRASIL* — sem partidas finalizadas.";
  return [
    `🇧🇷 *RAIO-X DO BRASIL — Copa 2026*`,
    `Campanha: *${metrics.wins}V ${metrics.draws}E ${metrics.losses}D* · gols *${metrics.goalsFor}-${metrics.goalsAgainst}*`,
    `xG estimado pelo tracker: *${metrics.xgFor.toFixed(2)}-${metrics.xgAgainst.toFixed(2)}* _(heurístico por zona; não oficial)_`,
    `Finalizações: *${metrics.shotsFor}-${metrics.shotsAgainst}* · no alvo *${metrics.shotsOnTargetFor}-${metrics.shotsOnTargetAgainst}* · conversão *${pct(metrics.conversion)}*`,
    `Chances claras estimadas: *${metrics.clearChancesFor}-${metrics.clearChancesAgainst}* · escanteios *${metrics.cornersFor}-${metrics.cornersAgainst}*`,
    `Disciplina/90: *${metrics.yellowPer90.toFixed(2)}* amarelos · *${metrics.redPer90.toFixed(2)}* vermelhos`,
    `Estado do placar: *${metrics.leadingMinutes} min* vencendo · *${metrics.drawingMinutes}* empatando · *${metrics.trailingMinutes}* perdendo _(cobertura timeline ${metrics.timelineCoverage}/${metrics.played})_`,
    `Gols marcados por período: ${periods(metrics.goalsForByPeriod)}`,
    `Gols sofridos por período: ${periods(metrics.goalsAgainstByPeriod)}`,
    `Continuidade dos titulares: *${pct(metrics.lineupContinuity)}* _(cobertura escalações ${pct(metrics.lineupCoverage)})_`,
    `_Fonte: FIFA API. xG/chances claras/estado temporal são derivados pelo tracker; ausências permanecem explícitas como n/d._`,
  ].join("\n");
}
