import { expect, test } from "bun:test";
import { splitForTelegram, truncateByCodePoints, TG_CAPTION_MAX } from "../src/telegram.ts";

test("truncateByCodePoints: preserves text shorter than limit", () => {
  const text = "Hello world";
  expect(truncateByCodePoints(text, 50)).toBe(text);
});

test("truncateByCodePoints: safely slices Unicode emojis without breaking surrogate pairs", () => {
  const emojiStr = "⚽️🇧🇷🏆".repeat(500); // multiple surrogate pairs
  const truncated = truncateByCodePoints(emojiStr, 1024);
  const codePoints = Array.from(truncated);
  expect(codePoints.length).toBeLessThanOrEqual(TG_CAPTION_MAX);
  // Ensure string is valid unicode and not corrupted
  expect(() => truncated.normalize()).not.toThrow();
});

test("splitForTelegram: handles text under TG_MAX", () => {
  const text = "A".repeat(100);
  expect(splitForTelegram(text)).toEqual([text]);
});

test("splitForTelegram: splits long text on code points and preserves surrogate pairs", () => {
  const longEmojiLine = "🔥".repeat(5000);
  const chunks = splitForTelegram(longEmojiLine);
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) {
    const cp = Array.from(chunk);
    expect(cp.length).toBeLessThanOrEqual(4096);
    expect(() => chunk.normalize()).not.toThrow();
  }
  expect(chunks.join("")).toBe(longEmojiLine);
});
