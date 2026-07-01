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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, body: Record<string, unknown>): Promise<void> {
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
    throw new Error(`Telegram ${method} ${res.status}: ${txt}`);
  }
}

export function sendMessage(text: string, preview = false): Promise<void> {
  return call("sendMessage", {
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: !preview,
  });
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
