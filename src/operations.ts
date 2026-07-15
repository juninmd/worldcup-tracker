import { stat } from "node:fs/promises";
import { cacheSummary, operationalSummary, type OperationalSummary } from "./db.ts";
import { loadState } from "./state.ts";
import { isFinished, mergedSeasonEvents, timeline } from "./sportsdb.ts";

const HEARTBEAT = new URL("../data/heartbeat", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export interface DeliveryAudit {
  trackedMatches: number;
  expectedGoals: number;
  postedGoals: number;
  missingGoals: number;
  duplicateKeys: number;
}

export interface RuntimeStatus {
  windowHours: number;
  operations: OperationalSummary;
  cache: { entries: number; newestAgeMs: number | null };
  heartbeatAgeSeconds: number | null;
  heartbeatStale: boolean;
  delivery: DeliveryAudit;
}

async function deliveryAudit(): Promise<DeliveryAudit> {
  const state = await loadState();
  const events = (await mergedSeasonEvents()).filter((event) =>
    isFinished(event) && state.prematchPosted.includes(event.idEvent));
  const goals = await Promise.all(events.map(async (event) => ({
    event,
    count: (await timeline(event.idEvent)).filter((item) =>
      /goal/i.test(item.strTimeline) && !/missed|disallow/i.test(item.strTimelineDetail ?? "")).length,
  })));
  let expectedGoals = 0, postedGoals = 0;
  for (const row of goals) {
    expectedGoals += row.count;
    postedGoals += state.postedGoals.filter((key) => key.startsWith(`${row.event.idEvent}:`)).length;
  }
  const keyLists = [state.postedGoals, state.prematchPosted, state.fulltimePosted, state.postedSubs,
    state.postedVar, state.postedUpcomingAlert, state.postedCards, state.postedAnalysis];
  const duplicateKeys = keyLists.reduce((sum, keys) => sum + keys.length - new Set(keys).size, 0);
  return {
    trackedMatches: events.length, expectedGoals, postedGoals,
    missingGoals: Math.max(0, expectedGoals - postedGoals), duplicateKeys,
  };
}

export async function runtimeStatus(windowHours = 24): Promise<RuntimeStatus> {
  const heartbeat = await stat(HEARTBEAT).catch(() => null);
  const heartbeatAgeSeconds = heartbeat ? Math.max(0, Math.round((Date.now() - heartbeat.mtimeMs) / 1000)) : null;
  const idleInterval = Number(process.env.POLL_INTERVAL_SEC ?? "60");
  return {
    windowHours,
    operations: operationalSummary(windowHours),
    cache: cacheSummary(),
    heartbeatAgeSeconds,
    heartbeatStale: heartbeatAgeSeconds === null || heartbeatAgeSeconds > idleInterval * 3,
    delivery: await deliveryAudit(),
  };
}

const pct = (value: number | null): string => value === null ? "n/d" : `${(value * 100).toFixed(1)}%`;
const age = (milliseconds: number | null): string => milliseconds === null ? "n/d" : milliseconds < 1000
  ? `${milliseconds}ms` : `${Math.round(milliseconds / 1000)}s`;

export function fmtOperationalStatus(status: RuntimeStatus): string {
  const op = status.operations;
  const lines = [
    `🩺 *SAÚDE OPERACIONAL — últimas ${status.windowHours}h*`,
    `Operações: *${op.total}* · sucesso *${pct(op.successRate)}* · erros *${op.errors}*`,
    `Cache fresco: *${op.cacheHits}* · fallback stale *${op.staleFallbacks}* · entradas *${status.cache.entries}* · dado mais novo *${age(status.cache.newestAgeMs)}*`,
    `Latência após detecção/requisição: *p50 ${op.latencyP50Ms ?? "n/d"}ms · p95 ${op.latencyP95Ms ?? "n/d"}ms*`,
    `Heartbeat: *${status.heartbeatAgeSeconds === null ? "ausente" : `${status.heartbeatAgeSeconds}s`}* ${status.heartbeatStale ? "❌ stale" : "✅ fresco"}`,
    `Alertas de gol: *${status.delivery.postedGoals}/${status.delivery.expectedGoals}* em ${status.delivery.trackedMatches} jogos · *${status.delivery.missingGoals} alerta(s) de gol pendente(s)* · duplicatas *${status.delivery.duplicateKeys}*`,
  ];
  for (const [name, slice] of Object.entries(op.bySubsystem)) {
    lines.push(`• ${name}: ${slice.total} ops · ${pct(slice.successRate)} · p95 ${slice.latencyP95Ms ?? "n/d"}ms`);
  }
  lines.push(`_Sem payloads, URLs autenticadas ou credenciais. Latência mede processamento após detecção, não publicação FIFA ponta a ponta._`);
  return lines.join("\n");
}
