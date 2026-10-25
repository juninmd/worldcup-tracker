import { describe, expect, test } from "bun:test";
import { config, requireTelegram } from "../src/config.ts";

describe("config", () => {
  test("importing config does not require telegram secrets", () => {
    expect(config.pollIntervalSec).toBeGreaterThan(0);
    expect(config.livePollIntervalSec).toBeGreaterThan(0);
    // The suite runs without a .env: building the object must stay side-effect free.
    expect(typeof config).toBe("object");
  });

  test("requireTelegram fails fast when a secret is missing", () => {
    const env = { TELEGRAM_BOT_TOKEN: "token" } as NodeJS.ProcessEnv;
    expect(() => requireTelegram(env)).toThrow("TELEGRAM_CHAT_ID");
    expect(() => requireTelegram({} as NodeJS.ProcessEnv)).toThrow("TELEGRAM_BOT_TOKEN");
  });

  test("requireTelegram returns both values when present", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "42",
    } as NodeJS.ProcessEnv;
    expect(requireTelegram(env)).toEqual({ token: "token", chat: "42" });
  });
});
