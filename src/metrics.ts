import { MODEL_VERSION, canonicalTeam, trainRatings } from "./elo.ts";
import { calibrateGoals, predictMatch } from "./predict.ts";
import { isFinished } from "./sportsdb.ts";
import type { WcEvent } from "./types.ts";

export interface EvaluatedPrediction {
  eventId: string;
  stage?: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  predictedHome: number;
  predictedAway: number;
  actualHome: number;
  actualAway: number;
  fifaRankHome?: number;
  fifaRankAway?: number;
}

export interface ModelMetrics {
  modelVersion: string;
  matches: number;
  brier: number | null;
  logLoss: number | null;
  rankedProbabilityScore: number | null;
  calibrationError: number | null;
  resultAccuracy: number | null;
  exactScoreRate: number | null;
  goalMae: number | null;
  fifaFavoriteAccuracy: number | null;
  byStage: Record<string, EvaluationBreakdown>;
  byConfidence: Record<string, EvaluationBreakdown>;
  brazil: {
    matches: number;
    brier: number | null;
    resultAccuracy: number | null;
    goalBias: number | null;
  };
}

export interface EvaluationBreakdown {
  matches: number;
  brier: number;
  resultAccuracy: number;
}

const resultIndex = (home: number, away: number): 0 | 1 | 2 => home > away ? 0 : home === away ? 1 : 2;
const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rounded = (value: number | null, digits = 4): number | null => value === null ? null : Number(value.toFixed(digits));

function brier(row: EvaluatedPrediction): number {
  const actual = resultIndex(row.actualHome, row.actualAway);
  const probabilities = [row.pHome, row.pDraw, row.pAway];
  return probabilities.reduce((sum, probability, index) => sum + (probability - (index === actual ? 1 : 0)) ** 2, 0);
}

function isCorrect(row: EvaluatedPrediction): boolean {
  const probabilities = [row.pHome, row.pDraw, row.pAway];
  return probabilities.indexOf(Math.max(...probabilities)) === resultIndex(row.actualHome, row.actualAway);
}

const breakdown = (rows: EvaluatedPrediction[]): EvaluationBreakdown => ({
  matches: rows.length,
  brier: rounded(mean(rows.map(brier)))!,
  resultAccuracy: rounded(mean(rows.map((row) => isCorrect(row) ? 1 : 0)))!,
});

function groupedBreakdown(rows: EvaluatedPrediction[], key: (row: EvaluatedPrediction) => string): Record<string, EvaluationBreakdown> {
  const groups = new Map<string, EvaluatedPrediction[]>();
  for (const row of rows) (groups.get(key(row)) ?? groups.set(key(row), []).get(key(row))!).push(row);
  return Object.fromEntries([...groups.entries()].map(([name, values]) => [name, breakdown(values)]));
}

function calibrationError(rows: EvaluatedPrediction[]): number | null {
  if (!rows.length) return null;
  const bins = new Map<number, { confidence: number; correct: number; count: number }>();
  for (const row of rows) {
    const confidence = Math.max(row.pHome, row.pDraw, row.pAway);
    const key = Math.min(9, Math.floor(confidence * 10));
    const bin = bins.get(key) ?? { confidence: 0, correct: 0, count: 0 };
    bin.confidence += confidence;
    bin.correct += isCorrect(row) ? 1 : 0;
    bin.count++;
    bins.set(key, bin);
  }
  let error = 0;
  for (const bin of bins.values()) {
    error += (bin.count / rows.length) * Math.abs(bin.correct / bin.count - bin.confidence / bin.count);
  }
  return error;
}

export function evaluatePredictions(rows: EvaluatedPrediction[]): ModelMetrics {
  const actualProbabilities = rows.map((row) => [row.pHome, row.pDraw, row.pAway][resultIndex(row.actualHome, row.actualAway)]!);
  const rps = rows.map((row) => {
    const actual = resultIndex(row.actualHome, row.actualAway);
    const first = row.pHome - (actual === 0 ? 1 : 0);
    const second = row.pHome + row.pDraw - (actual <= 1 ? 1 : 0);
    return (first ** 2 + second ** 2) / 2;
  });
  const ranked = rows.filter((row) => row.fifaRankHome && row.fifaRankAway);
  const brazilRows = rows.filter((row) => [row.home, row.away].some((team) => canonicalTeam(team) === "Brazil"));
  const brazilBias = brazilRows.map((row) => canonicalTeam(row.home) === "Brazil"
    ? row.predictedHome - row.actualHome
    : row.predictedAway - row.actualAway);

  return {
    modelVersion: MODEL_VERSION,
    matches: rows.length,
    brier: rounded(mean(rows.map(brier))),
    logLoss: rounded(mean(actualProbabilities.map((probability) => -Math.log(Math.max(1e-12, probability))))),
    rankedProbabilityScore: rounded(mean(rps)),
    calibrationError: rounded(calibrationError(rows)),
    resultAccuracy: rounded(mean(rows.map((row) => isCorrect(row) ? 1 : 0))),
    exactScoreRate: rounded(mean(rows.map((row) => row.predictedHome === row.actualHome && row.predictedAway === row.actualAway ? 1 : 0))),
    goalMae: rounded(mean(rows.map((row) => (Math.abs(row.predictedHome - row.actualHome) + Math.abs(row.predictedAway - row.actualAway)) / 2))),
    fifaFavoriteAccuracy: rounded(mean(ranked.map((row) => {
      const favorite = row.fifaRankHome! < row.fifaRankAway! ? 0 : 2;
      return favorite === resultIndex(row.actualHome, row.actualAway) ? 1 : 0;
    }))),
    byStage: groupedBreakdown(rows, (row) => row.stage ?? "Sem fase"),
    byConfidence: groupedBreakdown(rows, (row) => {
      const confidence = Math.max(row.pHome, row.pDraw, row.pAway);
      return confidence < 0.5 ? "<50%" : confidence <= 0.65 ? "50-65%" : ">65%";
    }),
    brazil: {
      matches: brazilRows.length,
      brier: rounded(mean(brazilRows.map(brier))),
      resultAccuracy: rounded(mean(brazilRows.map((row) => isCorrect(row) ? 1 : 0))),
      goalBias: rounded(mean(brazilBias)),
    },
  };
}

/** Walk the tournament chronologically; each prediction sees only earlier results. */
export function buildLeakFreeBacktest(events: WcEvent[]): EvaluatedPrediction[] {
  const finished = events.filter(isFinished).sort((a, b) =>
    (a.strTimestamp ?? a.dateEvent).localeCompare(b.strTimestamp ?? b.dateEvent));
  const history: WcEvent[] = [];
  const rows: EvaluatedPrediction[] = [];
  for (const event of finished) {
    calibrateGoals(history);
    const prediction = predictMatch(trainRatings(history), event.strHomeTeam, event.strAwayTeam, history);
    rows.push({
      eventId: event.idEvent,
      stage: event.strStage ?? event.strGroup ?? "Sem fase",
      home: event.strHomeTeam,
      away: event.strAwayTeam,
      pHome: prediction.pHome,
      pDraw: prediction.pDraw,
      pAway: prediction.pAway,
      predictedHome: prediction.homeGoals,
      predictedAway: prediction.awayGoals,
      actualHome: Number(event.intHomeScore),
      actualAway: Number(event.intAwayScore),
      fifaRankHome: prediction.fifaRankHome,
      fifaRankAway: prediction.fifaRankAway,
    });
    history.push(event);
  }
  return rows;
}

const pct = (value: number | null): string => value === null ? "n/d" : `${(value * 100).toFixed(1)}%`;
const score = (value: number | null): string => value === null ? "n/d" : value.toFixed(4);

export function fmtModelMetrics(metrics: ModelMetrics): string {
  if (!metrics.matches) return `📐 *MÉTRICAS DO MODELO ${metrics.modelVersion}* — sem previsões avaliáveis.`;
  const stage = Object.entries(metrics.byStage).map(([name, value]) =>
    `• ${name}: ${value.matches} jogos · acerto ${pct(value.resultAccuracy)} · Brier ${score(value.brier)}`);
  const confidence = ["<50%", "50-65%", ">65%"].flatMap((name) => {
    const value = metrics.byConfidence[name];
    return value ? [`• ${name}: ${value.matches} jogos · acerto ${pct(value.resultAccuracy)} · Brier ${score(value.brier)}`] : [];
  });
  return [
    `📐 *MÉTRICAS DO MODELO ${metrics.modelVersion}* — ${metrics.matches} jogos`,
    `• Brier: *${score(metrics.brier)}* _(menor é melhor; 0 perfeito, 2 pior)_`,
    `• Log Loss: *${score(metrics.logLoss)}* _(menor é melhor; pune excesso de confiança)_`,
    `• RPS: *${score(metrics.rankedProbabilityScore)}* _(menor é melhor)_`,
    `• Erro de Calibração: *${pct(metrics.calibrationError)}* _(menor é melhor)_`,
    `• Resultado correto: *${pct(metrics.resultAccuracy)}*`,
    `• Placar exato: *${pct(metrics.exactScoreRate)}*`,
    `• MAE de gols/seleção: *${score(metrics.goalMae)}*`,
    `• Baseline favorito FIFA: *${pct(metrics.fifaFavoriteAccuracy)}*`,
    `• Odds de mercado: n/d _(não existem no feed FIFA; nenhuma comparação fabricada)_`,
    ``,
    `*Por fase*`,
    ...stage,
    ``,
    `*Faixa de confiança*`,
    ...confidence,
    ``,
    `🇧🇷 *Brasil* — ${metrics.brazil.matches} jogos`,
    `• Brier: *${score(metrics.brazil.brier)}* · resultado correto: *${pct(metrics.brazil.resultAccuracy)}*`,
    `• Viés de gols: *${metrics.brazil.goalBias === null ? "n/d" : `${metrics.brazil.goalBias > 0 ? "+" : ""}${metrics.brazil.goalBias.toFixed(2)}`}* _(positivo = superestima o Brasil)_`,
    `_Backtest temporal: cada jogo usa somente resultados anteriores. xG e índices de elenco não são dados oficiais._`,
  ].join("\n");
}
