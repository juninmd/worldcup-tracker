import { cacheGet, cachePut, recordOperationalEvent } from "./db.ts";
import { sendMessage } from "./telegram.ts";

export type NewsTopic =
  | "selecao"
  | "brasileirao"
  | "copadobrasil"
  | "libertadores"
  | "champions"
  | "premier";

export interface NewsItem {
  title: string;
  link: string;
  summary: string;
  pubDate: string;
}

export const TOPIC_CONFIG: Record<
  NewsTopic,
  { name: string; emoji: string; feedUrl: string }
> = {
  selecao: {
    name: "Seleção Brasileira",
    emoji: "🇧🇷",
    feedUrl: "https://ge.globo.com/rss/ge/futebol/selecao-brasileira/",
  },
  brasileirao: {
    name: "Brasileirão Série A",
    emoji: "🏆",
    feedUrl: "https://ge.globo.com/rss/ge/futebol/brasileirao-serie-a/",
  },
  copadobrasil: {
    name: "Copa do Brasil",
    emoji: "🥇",
    feedUrl: "https://ge.globo.com/rss/ge/futebol/copa-do-brasil/",
  },
  libertadores: {
    name: "Copa Libertadores",
    emoji: "⭐",
    feedUrl: "https://ge.globo.com/rss/ge/futebol/libertadores/",
  },
  champions: {
    name: "UEFA Champions League",
    emoji: "🌍",
    feedUrl:
      "https://ge.globo.com/rss/ge/futebol/futebol-internacional/liga-dos-campeoes/",
  },
  premier: {
    name: "Premier League",
    emoji: "🦁",
    feedUrl:
      "https://ge.globo.com/rss/ge/futebol/futebol-internacional/futebol-ingles/",
  },
};

const TTL_MS = 10 * 60_000; // 10 minutes cache
const FETCH_TIMEOUT_MS = 15_000;

function cleanText(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRssXml(xml: string): NewsItem[] {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const items: NewsItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const raw = match[1] ?? "";
    const rawTitle = (raw.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] ?? "";
    const rawLink = (raw.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] ?? "";
    const rawDesc = (raw.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] ?? "";
    const rawPubDate = (raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] ?? "";

    const title = cleanText(rawTitle);
    const link = rawLink.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    const summary = cleanText(rawDesc);
    const pubDate = cleanText(rawPubDate);

    if (title && link) {
      items.push({
        title,
        link,
        summary: summary.slice(0, 180) + (summary.length > 180 ? "…" : ""),
        pubDate,
      });
    }
  }

  return items;
}

export async function fetchNews(topic: NewsTopic): Promise<NewsItem[]> {
  const config = TOPIC_CONFIG[topic];
  if (!config) throw new Error(`Tópico de notícias desconhecido: ${topic}`);

  const cachePath = `news:${topic}`;
  const started = Date.now();
  const observe = (outcome: "ok" | "cache" | "stale" | "error") =>
    recordOperationalEvent({
      subsystem: "fifa", // use existing subsystem telemetry
      operation: cachePath,
      outcome,
      latencyMs: Date.now() - started,
    });

  const hit = cacheGet(cachePath);
  if (hit && hit.age < TTL_MS) {
    observe("cache");
    return parseRssXml(hit.body);
  }

  try {
    const res = await fetch(config.feedUrl, {
      headers: { "User-Agent": "worldcup-tracker/1.0 (news-monitor)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.ok) {
      const xml = await res.text();
      cachePut(cachePath, xml);
      observe("ok");
      return parseRssXml(xml);
    }

    if (hit) {
      observe("stale");
      return parseRssXml(hit.body);
    }
    observe("error");
    return [];
  } catch {
    if (hit) {
      observe("stale");
      return parseRssXml(hit.body);
    }
    observe("error");
    return [];
  }
}

export function fmtNews(topic: NewsTopic, items: NewsItem[], limit = 5): string {
  const config = TOPIC_CONFIG[topic] ?? {
    name: topic,
    emoji: "📰",
  };
  const slice = items.slice(0, limit);

  if (slice.length === 0) {
    return `${config.emoji} *${config.name} — Notícias*\n\nNenhuma notícia disponível no momento.`;
  }

  const lines = [
    `${config.emoji} *${config.name} — Plantão de Notícias*`,
    `_Últimas atualizações via ge.globo:_\n`,
  ];

  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    if (!item) continue;
    lines.push(`*${i + 1}. ${item.title}*`);
    if (item.summary) lines.push(`_${item.summary}_`);
    lines.push(`🔗 [Ler matéria completa](${item.link})\n`);
  }

  return lines.join("\n").trim();
}

export async function postNews(topic: NewsTopic, limit = 5): Promise<void> {
  const items = await fetchNews(topic);
  const msg = fmtNews(topic, items, limit);
  await sendMessage(msg);
}
