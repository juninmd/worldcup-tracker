import { expect, test } from "bun:test";
import { loadState } from "../src/state.ts";

test("loadState: default shape includes card and zebra-analysis dedup lists", async () => {
  const state = await loadState();
  expect(Array.isArray(state.postedCards)).toBe(true);
  expect(Array.isArray(state.postedAnalysis)).toBe(true);
});
