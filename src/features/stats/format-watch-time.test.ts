import { describe, expect, it } from "vitest";

import { formatWatchTime } from "./format-watch-time";

describe("formatWatchTime", () => {
  it.each([
    [0, "0m"],
    [1, "1s"],
    [45, "45s"],
    [59, "59s"],
    [60, "1m"],
    [90, "1m"],
    [3_599, "59m"],
    [3_600, "1h"],
    [3_661, "1h 1m"],
    [5_400, "1h 30m"],
    [86_400, "24h"],
    [172_800, "48h"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatWatchTime(seconds)).toBe(expected);
  });

  it("rounds fractional seconds", () => {
    expect(formatWatchTime(59.6)).toBe("1m");
  });

  it("returns null for values that cannot be rendered", () => {
    expect(formatWatchTime(null)).toBeNull();
    expect(formatWatchTime(-1)).toBeNull();
    expect(formatWatchTime(Number.NaN)).toBeNull();
    expect(formatWatchTime(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
