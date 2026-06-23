import { expect, test } from "bun:test";
import { missingKeyPlayers, lineupPenalty } from "../src/injuries.ts";
import type { LineupPlayer } from "../src/types.ts";

test("missingKeyPlayers: returns empty if history is empty", () => {
  const history = new Map();
  const xi: LineupPlayer[] = [];
  const missing = missingKeyPlayers(xi, "Brazil", true, history);
  expect(missing).toEqual([]);
});

test("missingKeyPlayers: identifies missing regular starters case-insensitively", () => {
  // Setup starter history: Neymar is a regular starter (started 2 games)
  // Marquinhos started 2 games.
  // Lucas Moura started 1 game.
  const history = new Map();
  history.set("Brazil|Neymar", { starts: 2, pos: "Forward" });
  history.set("Brazil|Marquinhos", { starts: 2, pos: "Defender" });
  history.set("Brazil|Lucas Moura", { starts: 1, pos: "Forward" });

  const xi: LineupPlayer[] = [
    { strPlayer: "Marquinhos", strPosition: "Defender", strSubstitute: "No", strHome: "Yes", intSquadNumber: "3" },
    { strPlayer: "Lucas Moura", strPosition: "Forward", strSubstitute: "Yes", strHome: "Yes", intSquadNumber: "7" },
  ];

  const missing = missingKeyPlayers(xi, "Brazil", true, history);
  const missingNames = missing.map((m) => m.name);
  expect(missingNames).toContain("Neymar");
  expect(missingNames).toContain("Lucas Moura");
  expect(missingNames).not.toContain("Marquinhos");

  // Test case insensitivity
  const xiCaps: LineupPlayer[] = [
    { strPlayer: "MARQUINHOS", strPosition: "Defender", strSubstitute: "no", strHome: "YES", intSquadNumber: "3" },
    { strPlayer: "LUCAS MOURA", strPosition: "Forward", strSubstitute: "yes", strHome: "YES", intSquadNumber: "7" },
  ];
  const missingCaps = missingKeyPlayers(xiCaps, "Brazil", true, history);
  const missingCapsNames = missingCaps.map((m) => m.name);
  expect(missingCapsNames).toContain("Neymar");
  expect(missingCapsNames).toContain("Lucas Moura");
  expect(missingCapsNames).not.toContain("Marquinhos");
});

test("lineupPenalty: sums up missing player weights", () => {
  const history = new Map();
  history.set("Brazil|Neymar", { starts: 2, pos: "Forward" }); // weight 5
  history.set("Brazil|Marquinhos", { starts: 2, pos: "Defender" }); // weight 3

  const xi: LineupPlayer[] = [
    { strPlayer: "Marquinhos", strPosition: "Defender", strSubstitute: "No", strHome: "Yes", intSquadNumber: "3" }
  ];

  const penalty = lineupPenalty(xi, "Brazil", true, history);
  expect(penalty).toBe(5);
});
