import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SEARCH_FILTERS,
  SEARCH_DURATION_VALUES,
  SEARCH_ORDER_VALUES,
  SEARCH_UPLOAD_DATE_VALUES,
  nonDefaultSearchFilters,
  resolveSearchFilters,
  searchPublishedAfter,
} from "@/shared/search-filters";
import { DomainValidationError } from "@/shared/validation";

describe("resolveSearchFilters", () => {
  it("falls back to the defaults for absent or blank values", () => {
    expect(resolveSearchFilters({})).toEqual(DEFAULT_SEARCH_FILTERS);
    expect(resolveSearchFilters({ duration: null, order: undefined, uploadDate: "   " })).toEqual(
      DEFAULT_SEARCH_FILTERS,
    );
  });

  it("accepts every enumerated value", () => {
    for (const duration of SEARCH_DURATION_VALUES) {
      expect(resolveSearchFilters({ duration }).duration).toBe(duration);
    }

    for (const order of SEARCH_ORDER_VALUES) {
      expect(resolveSearchFilters({ order }).order).toBe(order);
    }

    for (const uploadDate of SEARCH_UPLOAD_DATE_VALUES) {
      expect(resolveSearchFilters({ uploadDate }).uploadDate).toBe(uploadDate);
    }
  });

  it("trims surrounding whitespace before matching", () => {
    expect(resolveSearchFilters({ duration: " short ", order: " date " })).toMatchObject({
      duration: "short",
      order: "date",
    });
  });

  it.each([
    ["duration", "tiny"],
    ["duration", "SHORT"],
    ["order", "popular"],
    ["order", "viewcount"],
    ["uploadDate", "year"],
    ["uploadDate", "days"],
  ] as const)("rejects an invalid %s value %j", (field, value) => {
    let thrown: unknown;
    try {
      resolveSearchFilters({ [field]: value });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainValidationError);
    expect((thrown as DomainValidationError).code).toBe("invalid_format");
    expect((thrown as DomainValidationError).field).toBe(field);
  });

  it("rejects non-string values with the field name", () => {
    for (const input of [{ duration: 42 }, { order: ["date"] }, { uploadDate: {} }]) {
      expect(() => resolveSearchFilters(input)).toThrowError(DomainValidationError);
    }

    try {
      resolveSearchFilters({ order: ["date"] });
    } catch (error) {
      expect((error as DomainValidationError).field).toBe("order");
    }
  });
});

describe("nonDefaultSearchFilters", () => {
  it("returns an empty object for the defaults", () => {
    expect(nonDefaultSearchFilters({ ...DEFAULT_SEARCH_FILTERS })).toEqual({});
  });

  it("returns only the filters that differ from their defaults", () => {
    expect(
      nonDefaultSearchFilters({ duration: "long", order: "relevance", uploadDate: "week" }),
    ).toEqual({ duration: "long", uploadDate: "week" });
  });
});

describe("searchPublishedAfter", () => {
  const NOW = Date.parse("2026-01-01T12:00:00.000Z");

  it("returns null when no date filter is active", () => {
    expect(searchPublishedAfter("any", NOW)).toBeNull();
  });

  // REGRESSION: a default parameter (`nowMs = Date.now()`) reads the clock even
  // when the early return makes the value irrelevant. During prerender Next
  // rejects that as blocking-prerender-current-time, which broke `/`.
  it("does not read the clock when the upload window is any", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);

    try {
      expect(searchPublishedAfter("any")).toBeNull();
      expect(nowSpy).not.toHaveBeenCalled();

      // A real window still reads the clock, lazily.
      expect(searchPublishedAfter("day")).toBe("2025-12-31T12:00:00.000Z");
      expect(nowSpy).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("subtracts the documented window for each option", () => {
    expect(searchPublishedAfter("day", NOW)).toBe("2025-12-31T12:00:00.000Z");
    expect(searchPublishedAfter("week", NOW)).toBe("2025-12-25T12:00:00.000Z");
    expect(searchPublishedAfter("month", NOW)).toBe("2025-12-02T12:00:00.000Z");
  });
});
