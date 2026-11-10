import { describe, expect, it } from "vitest";

import { buildSearchHref } from "@/components/search/search-url";

describe("buildSearchHref", () => {
  it("keeps the unfiltered URL short", () => {
    expect(buildSearchHref("rick astley")).toBe("/search?q=rick+astley");
  });

  it("appends the page token after the query", () => {
    expect(buildSearchHref("rick astley", "CAoQAA")).toBe("/search?q=rick+astley&pageToken=CAoQAA");
  });

  it("appends the non-default filters in their canonical order", () => {
    expect(
      buildSearchHref("rick", "CAoQAA", {
        duration: "short",
        order: "viewCount",
        uploadDate: "week",
      }),
    ).toBe("/search?q=rick&pageToken=CAoQAA&duration=short&order=viewCount&uploadDate=week");
  });

  it("omits default filter values", () => {
    expect(
      buildSearchHref("rick", null, {
        duration: "any",
        order: "relevance",
        uploadDate: "any",
      }),
    ).toBe("/search?q=rick");
  });

  it("accepts a partial filter object and merges it over the defaults", () => {
    expect(buildSearchHref("rick", null, { uploadDate: "day" })).toBe(
      "/search?q=rick&uploadDate=day",
    );
  });

  it("encodes a query with characters that are unsafe in a URL", () => {
    const url = new URL(buildSearchHref("cats & dogs?", null), "https://viewly.test");

    expect(url.searchParams.get("q")).toBe("cats & dogs?");
  });
});
