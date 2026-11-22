import { expect, test } from "bun:test";
import { bucketOfMinute } from "../src/goaltimes.ts";
import { compareMinute, parseMinute } from "../src/minute.ts";

test("stoppage-time goals land in 45+ / 90+, not in 1-15", () => {
  expect(bucketOfMinute("90+3")).toBe("90+");
  expect(bucketOfMinute("45+2")).toBe("45+");
  expect(bucketOfMinute("45")).toBe("31-45");
  expect(bucketOfMinute("46")).toBe("46-60");
  expect(bucketOfMinute("7")).toBe("1-15");
});

test("parseMinute reads plain and stoppage minutes", () => {
  expect(parseMinute("67")).toEqual({ base: 67, added: 0 });
  expect(parseMinute(" 90 + 4 ")).toEqual({ base: 90, added: 4 });
  expect(parseMinute("")).toBeNull();
  expect(parseMinute("HT")).toBeNull();
});

test("goals sort chronologically even with stoppage time", () => {
  const order = ["90+1", "30", "45+2", "46", "45"].sort(compareMinute);
  expect(order).toEqual(["30", "45", "45+2", "46", "90+1"]);
});
