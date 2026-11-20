import { expect, test } from "bun:test";

// Usage errors must fail the process so scripts and CI notice a bad invocation.
test("cli: missing arguments print usage and exit non-zero", () => {
  const res = Bun.spawnSync([process.execPath, "run", "src/cli.ts", "h2h"], { stderr: "pipe", stdout: "pipe" });
  expect(res.stderr.toString()).toContain("usage: h2h");
  expect(res.exitCode).toBe(1);
});
