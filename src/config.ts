function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  telegramToken: req("TELEGRAM_BOT_TOKEN"),
  telegramChat: req("TELEGRAM_CHAT_ID"),
  pollIntervalSec: Number(process.env.POLL_INTERVAL_SEC ?? "60"),
};
