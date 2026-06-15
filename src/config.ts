function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  telegramToken: req("TELEGRAM_BOT_TOKEN"),
  telegramChat: req("TELEGRAM_CHAT_ID"),
  sportsdbKey: process.env.SPORTSDB_KEY ?? "3",
  leagueId: process.env.WC_LEAGUE_ID ?? "4429",
  season: process.env.WC_SEASON ?? "2026",
  pollIntervalSec: Number(process.env.POLL_INTERVAL_SEC ?? "60"),
};
