import { config } from "./config.ts";

const api = (m: string) =>
  `https://api.telegram.org/bot${config.telegramToken}/${m}`;

async function post(method: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.telegramChat, ...body }),
  });
}

async function call(method: string, body: Record<string, unknown>): Promise<void> {
  let res = await post(method, body);
  // Feed text can contain unbalanced Markdown (* _ [ ]) that Telegram rejects.
  // Retry once as plain text so the alert still lands instead of crashing the poll.
  if (res.status === 400 && body.parse_mode) {
    const { parse_mode, ...plain } = body;
    res = await post(method, plain);
  }
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
