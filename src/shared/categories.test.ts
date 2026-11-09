import { describe, expect, it } from "vitest";

import { CATEGORIES } from "@/shared/categories";
import { assertSearchQuery } from "@/shared/validation";

/** Lowercase, kebab-case public slug. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Categories the discovery surface is expected to ship. */
const EXPECTED_SLUGS = ["music", "gaming", "technology", "sports", "news", "comedy"];

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  return [...duplicates];
}

describe("CATEGORIES", () => {
  it("defines at least six discovery sections", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(6);
  });

  it("gives every category a non-empty, URL-safe slug", () => {
    for (const category of CATEGORIES) {
      expect(category.slug).toBe(category.slug.trim());
      expect(category.slug).toMatch(SLUG_PATTERN);
    }
  });

  it("keeps slugs unique", () => {
    expect(findDuplicates(CATEGORIES.map((category) => category.slug))).toEqual([]);
  });

  it("gives every category a non-empty display name", () => {
    for (const category of CATEGORIES) {
      expect(category.name).toBe(category.name.trim());
      expect(category.name.length).toBeGreaterThan(0);
    }
  });

  it("gives every category a non-empty, search-safe query", () => {
    for (const category of CATEGORIES) {
      expect(category.query).toBe(category.query.trim());
      expect(() => assertSearchQuery(category.query)).not.toThrow();
    }
  });

  it("keeps queries unique", () => {
    expect(findDuplicates(CATEGORIES.map((category) => category.query))).toEqual([]);
  });

  it("includes the stable baseline categories", () => {
    const slugs = CATEGORIES.map((category) => category.slug);
    expect(slugs).toEqual(expect.arrayContaining(EXPECTED_SLUGS));
  });
});
