import { config } from "./config.ts";

const api = (m: string) =>
  `https://api.telegram.org/bot${config.telegramToken}/${m}`;

async function call(method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.telegramChat, ...body }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Telegram ${method} ${res.status}: ${txt}`);
  }
}

export function sendMessage(text: string): Promise<void> {
  return call("sendMessage", {
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}

export async function sendPhoto(photoUrl: string, caption: string): Promise<void> {
  try {
    await call("sendPhoto", { photo: photoUrl, caption, parse_mode: "Markdown" });
  } catch {
    // Image URL rejected by Telegram → fall back to text so the alert still lands.
    await sendMessage(caption);
  }
}
