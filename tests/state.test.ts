import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../src/state.ts";

test("loadState: default shape includes card and zebra-analysis dedup lists", async () => {
  const state = await loadState();
  expect(Array.isArray(state.postedCards)).toBe(true);
  expect(Array.isArray(state.postedAnalysis)).toBe(true);
});

test("saveState: round-trips and leaves no temp file behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wc-state-"));
  const file = join(dir, "nested", "state.json");
  const state = await loadState(file);
  state.postedGoals.push("1:home:1");
  await saveState(state, file);
  await saveState(state, file);
  expect((await loadState(file)).postedGoals).toEqual(["1:home:1"]);
  expect(await readdir(join(dir, "nested"))).toEqual(["state.json"]);
});

test("loadState: corrupt file starts empty but is kept for inspection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wc-state-"));
  const file = join(dir, "state.json");
  await writeFile(file, '{"postedGoals": ["1:ho');
  expect((await loadState(file)).postedGoals).toEqual([]);
  expect(existsSync(file)).toBe(false);
  expect(await readFile(`${file}.corrupt`, "utf8")).toContain("postedGoals");
});
