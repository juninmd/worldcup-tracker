function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  telegramToken: req("TELEGRAM_BOT_TOKEN"),
  telegramChat: req("TELEGRAM_CHAT_ID"),
  pollIntervalSec: Number(process.env.POLL_INTERVAL_SEC ?? "60"),
  // While a match is live, poll faster to catch goals/cards/VAR sooner — bounded
  // near the FIFA timeline cache TTL (15s in sportsdb.ts) so going lower would
  // just re-request the same cached response instead of fresher data.
  livePollIntervalSec: Number(process.env.LIVE_POLL_INTERVAL_SEC ?? "20"),
};
