import { requireTelegram } from "./config.ts";
import { recordOperationalEvent } from "./db.ts";

const api = (token: string, m: string) =>
  `https://api.telegram.org/bot${token}/${m}`;

async function post(method: string, body: Record<string, unknown>): Promise<Response> {
  const { token, chat } = requireTelegram();
  return fetch(api(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, body: Record<string, unknown>): Promise<void> {
  const started = Date.now();
  let res = await post(method, body);
  // Feed text can contain unbalanced Markdown (* _ [ ]) that Telegram rejects.
  // Retry once as plain text so the alert still lands instead of crashing the poll.
  if (res.status === 400 && body.parse_mode) {
    const { parse_mode, ...plain } = body;
    res = await post(method, plain);
  }
  // Telegram throttles bursts (~20 msg/min/group); honour retry_after and resend.
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    const body429 = (await res.clone().json().catch(() => null)) as
      { parameters?: { retry_after?: number } } | null;
    const wait = body429?.parameters?.retry_after ?? 5;
    await sleep((wait + 1) * 1000);
    res = await post(method, body);
  }
  if (!res.ok) {
    const txt = await res.text();
    recordOperationalEvent({ subsystem: "telegram", operation: method, outcome: "error", latencyMs: Date.now() - started });
    throw new Error(`Telegram ${method} ${res.status}: ${txt}`);
  }
  recordOperationalEvent({ subsystem: "telegram", operation: method, outcome: "ok", latencyMs: Date.now() - started });
}

// Telegram hard-caps a text message at 4096 chars; a verbose LLM take can exceed
// it and the whole post is rejected (400 "message is too long"). Split on line
// boundaries so long content still lands instead of vanishing.
const TG_MAX = 4096;

function splitForTelegram(text: string): string[] {
  if (text.length <= TG_MAX) return [text];
  const chunks: string[] = [];
  let buf = "";
  const flush = () => { if (buf) { chunks.push(buf); buf = ""; } };
  for (const line of text.split("\n")) {
    // A single line longer than the cap can't ride in one message — slice it.
    let rest = line;
    while (rest.length > TG_MAX) { flush(); chunks.push(rest.slice(0, TG_MAX)); rest = rest.slice(TG_MAX); }
    if (buf.length + rest.length + 1 > TG_MAX) flush();
    buf = buf ? `${buf}\n${rest}` : rest;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export async function sendMessage(text: string, preview = false): Promise<void> {
  for (const chunk of splitForTelegram(text)) {
    await call("sendMessage", {
      text: chunk,
      parse_mode: "Markdown",
      disable_web_page_preview: !preview,
    });
  }
}

export async function sendPhoto(photoUrl: string, caption: string): Promise<void> {
  try {
    await sendPhotoStrict(photoUrl, caption);
  } catch {
    // Image URL rejected by Telegram → fall back to text so the alert still lands.
    await sendMessage(caption);
  }
}

export function sendPhotoStrict(photoUrl: string, caption: string): Promise<void> {
  return call("sendPhoto", { photo: photoUrl, caption, parse_mode: "Markdown" });
}

/** Photo album (2–10 images) with the caption on the first item — used to show
 *  both team badges / event artwork together as a single rich card. */
export async function sendMediaGroup(photoUrls: string[], caption: string): Promise<void> {
  const photos = photoUrls.filter(Boolean).slice(0, 10);
  if (photos.length < 2) { // album needs ≥2; otherwise a single photo (or text)
    if (photos[0]) return sendPhoto(photos[0], caption);
    return sendMessage(caption);
  }
  const media = photos.map((photo, i) =>
    i === 0 ? { type: "photo", media: photo, caption, parse_mode: "Markdown" } : { type: "photo", media: photo });
  try {
    await call("sendMediaGroup", { media });
  } catch {
    await sendMessage(caption); // album rejected → keep the text alert
  }
}

export async function sendMediaGroupStrict(photoUrls: string[], caption: string): Promise<void> {
  const photos = photoUrls.filter(Boolean).slice(0, 10);
  if (photos.length < 2) {
    if (photos[0]) return sendPhotoStrict(photos[0], caption);
    throw new Error("sendMediaGroupStrict requires at least one photo");
  }
  const media = photos.map((photo, i) =>
    i === 0 ? { type: "photo", media: photo, caption, parse_mode: "Markdown" } : { type: "photo", media: photo });
  await call("sendMediaGroup", { media });
}
