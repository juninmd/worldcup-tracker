function opt(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return env[name] ?? "";
}

/**
 * Telegram credentials, resolved only when a message is actually sent.
 *
 * Reading them at module load made every import of `telegram.ts` (and of
 * anything that imports `config`) fail without a `.env`, which broke the whole
 * test suite in CI. Configuration stays lazy so tests and read-only commands
 * run without secrets; sending without them still fails fast and loudly.
 */
export function requireTelegram(
  env: NodeJS.ProcessEnv = process.env,
): { token: string; chat: string } {
  const token = opt("TELEGRAM_BOT_TOKEN", env);
  const chat = opt("TELEGRAM_CHAT_ID", env);
  if (!token) throw new Error("Missing env var: TELEGRAM_BOT_TOKEN");
  if (!chat) throw new Error("Missing env var: TELEGRAM_CHAT_ID");
  return { token, chat };
}

/**
 * Seconds from an env var, falling back when unset, empty, non-numeric or <= 0.
 * `POLL_INTERVAL_SEC=` (empty) used to become 0 and `abc` NaN: `Bun.sleep` then returned at once,
 * so the tracker hammered the FIFA API in a tight loop.
 */
export function positiveSeconds(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim() || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  pollIntervalSec: positiveSeconds(process.env.POLL_INTERVAL_SEC, 60),
  // While a match is live, poll faster to catch goals/cards/VAR sooner - bounded
  // near the FIFA timeline cache TTL (15s in sportsdb.ts) so going lower would
  // just re-request the same cached response instead of fresher data.
  livePollIntervalSec: positiveSeconds(process.env.LIVE_POLL_INTERVAL_SEC, 20),
};
