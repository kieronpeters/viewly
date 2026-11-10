import { describe, expect, it } from "vitest";

import { formatCount, formatDuration, formatViewCount } from "@/shared/format";

describe("formatDuration", () => {
  it("formats durations under an hour as m:ss", () => {
    expect(formatDuration(83)).toBe("1:23");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(0)).toBe("0:00");
  });

  it("formats an hour or more as h:mm:ss with padded minutes and seconds", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(36000)).toBe("10:00:00");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(83.9)).toBe("1:23");
    expect(formatDuration(3599.99)).toBe("59:59");
  });

  it("returns null for values that cannot be rendered", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatCount", () => {
  it("renders plain and compact counts without a noun", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1)).toBe("1");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1200)).toBe("1.2K");
    expect(formatCount(999_999)).toBe("1M");
    expect(formatCount(2_000_000_000)).toBe("2B");
  });

  it("floors fractional counts and rejects unusable values", () => {
    expect(formatCount(1200.9)).toBe("1.2K");
    expect(formatCount(null)).toBeNull();
    expect(formatCount(-1)).toBeNull();
    expect(formatCount(Number.NaN)).toBeNull();
    expect(formatCount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatViewCount", () => {
  it("spells out counts below one thousand", () => {
    expect(formatViewCount(0)).toBe("0 views");
    expect(formatViewCount(1)).toBe("1 view");
    expect(formatViewCount(2)).toBe("2 views");
    expect(formatViewCount(999)).toBe("999 views");
  });

  it("uses compact units with at most one decimal place", () => {
    expect(formatViewCount(1000)).toBe("1K views");
    expect(formatViewCount(1200)).toBe("1.2K views");
    expect(formatViewCount(1250)).toBe("1.3K views");
    expect(formatViewCount(1_500_000)).toBe("1.5M views");
    expect(formatViewCount(2_000_000_000)).toBe("2B views");
  });

  it("promotes values that would otherwise round to 1000 of a unit", () => {
    expect(formatViewCount(999_999)).toBe("1M views");
    expect(formatViewCount(999_999_999)).toBe("1B views");
  });

  it("rounds instead of truncating at the displayed precision", () => {
    expect(formatViewCount(1999)).toBe("2K views");
    expect(formatViewCount(1_049_999)).toBe("1M views");
  });

  it("floors fractional counts", () => {
    expect(formatViewCount(1200.9)).toBe("1.2K views");
  });

  it("returns null for values that cannot be rendered", () => {
    expect(formatViewCount(null)).toBeNull();
    expect(formatViewCount(-1)).toBeNull();
    expect(formatViewCount(Number.NaN)).toBeNull();
    expect(formatViewCount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
