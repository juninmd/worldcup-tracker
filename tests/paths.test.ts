import { expect, test } from "bun:test";
import { dataPath } from "../src/paths.ts";

test("dataPath: decodes %-escapes so a checkout under 'João Copa' writes to the real data dir", () => {
  // import.meta.url of a module in a folder with a space and a non-ASCII char
  const base = "file:///opt/Jo%C3%A3o%20Copa/src/state.ts";
  expect(dataPath("state.json", base)).toBe("/opt/João Copa/data/state.json");
});

test("dataPath: default base resolves next to src/", () => {
  expect(dataPath("wc.db")).toMatch(/[\\/]data[\\/]wc\.db$/);
});
