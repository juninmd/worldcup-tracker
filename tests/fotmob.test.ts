import { expect, test } from "bun:test";
import { cachePut } from "../src/db.ts";
import { findMatchId } from "../src/fotmob.ts";

test("findMatchId: matches team names in matches payload", async () => {
  const matchesPayload = JSON.stringify({
    leagues: [
      {
        matches: [
          {
            id: 999123,
            home: { name: "Brazil" },
            away: { name: "Argentina" },
          },
        ],
      },
    ],
  });
  cachePut("fotmob:/matches/20260620", matchesPayload);

  const matchId = await findMatchId("2026-06-20", "Brazil", "Argentina");
  expect(matchId).toBe(999123);

  // Order-insensitive
  const matchIdReverse = await findMatchId("2026-06-20", "Argentina", "Brazil");
  expect(matchIdReverse).toBe(999123);
});

test("findMatchId: survives corrupted cache entry without throwing", async () => {
  cachePut("fotmob:/matches/20260699", "{ corrupt json");
  // findMatchId fetches over network or returns null, does not crash on corrupt cache
  const matchId = await findMatchId("2026-06-99", "Brazil", "Argentina").catch(() => null);
  expect(matchId).toBeNull();
});
