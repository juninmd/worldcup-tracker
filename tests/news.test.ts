import { expect, test } from "bun:test";
import { fmtNews, parseRssXml, type NewsItem } from "../src/news.ts";

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ge &gt; seleção brasileira</title>
    <item>
      <title><![CDATA[Brasil Sub-20: veja os convocados &amp; programação]]></title>
      <link>https://ge.globo.com/futebol/noticia/2026/10/brasil-sub-20.ghtml</link>
      <description><![CDATA[<p>Amistosos em Belém serão os últimos antes do Sul-Americano.</p>]]></description>
      <pubDate>Fri, 30 Oct 2026 20:12:37 -0000</pubDate>
    </item>
    <item>
      <title>Ancelotti elogia Vini Jr e Rodrygo</title>
      <link>https://ge.globo.com/futebol/noticia/2026/10/vini-rodrygo.ghtml</link>
      <description>Atacantes da Seleção foram decisivos na Champions.</description>
      <pubDate>Thu, 29 Oct 2026 15:00:00 -0000</pubDate>
    </item>
  </channel>
</rss>`;

test("parseRssXml: parses items, strips CDATA and decodes entities", () => {
  const items = parseRssXml(sampleRss);
  expect(items.length).toBe(2);
  expect(items[0]!.title).toBe("Brasil Sub-20: veja os convocados & programação");
  expect(items[0]!.link).toBe("https://ge.globo.com/futebol/noticia/2026/10/brasil-sub-20.ghtml");
  expect(items[0]!.summary).toBe("Amistosos em Belém serão os últimos antes do Sul-Americano.");
  expect(items[1]!.title).toBe("Ancelotti elogia Vini Jr e Rodrygo");
});

test("parseRssXml: handles empty or malformed XML gracefully", () => {
  expect(parseRssXml("")).toEqual([]);
  expect(parseRssXml("<channel></channel>")).toEqual([]);
});

test("fmtNews: formats news items with markdown and links", () => {
  const items: NewsItem[] = [
    {
      title: "Brasil vence amistoso",
      link: "https://ge.globo.com/1",
      summary: "Ótima atuação em campo.",
      pubDate: "Fri, 30 Oct 2026",
    },
  ];
  const out = fmtNews("selecao", items, 1);
  expect(out).toContain("Seleção Brasileira — Plantão de Notícias");
  expect(out).toContain("1. Brasil vence amistoso");
  expect(out).toContain("Ótima atuação em campo.");
  expect(out).toContain("https://ge.globo.com/1");
});

test("fmtNews: handles empty state without crashing", () => {
  const out = fmtNews("selecao", []);
  expect(out).toContain("Nenhuma notícia disponível no momento");
});
