import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` deliberately throws when imported outside a Server Component
// graph; Vitest is not one, so the marker module is mocked here.
vi.mock("server-only", () => ({}));

// Only `searchVideos` is replaced; the rest of the client module (including its
// error class) stays real, so the test exercises the real import graph.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, searchVideos: vi.fn() };
});

import { getCategoryBySlug, getCategoryVideos, listCategories } from "@/features/search/categories";
import { searchVideos } from "@/lib/youtube/client";
import { CATEGORIES, type CategoryDefinition } from "@/shared/categories";
import type { SearchPage, VideoSummary } from "@/shared/types";
import { DomainValidationError } from "@/shared/validation";

const SUMMARY: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1500000000,
};

const PAGE: SearchPage = {
  items: [SUMMARY],
  nextPageToken: "CAoQAA",
  totalResults: 1234,
};

/** A 513-character token: one over the shared 512-character limit. */
const OVERSIZED_PAGE_TOKEN = "a".repeat(513);

const searchVideosMock = vi.mocked(searchVideos);

function categoryFor(slug: string): CategoryDefinition {
  const category = CATEGORIES.find((candidate) => candidate.slug === slug);
  if (category === undefined) {
    throw new Error(`Test fixture is missing the "${slug}" category.`);
  }

  return category;
}

beforeEach(() => {
  searchVideosMock.mockReset();
  // Any direct network access would be a bug in this layer, so make it loud.
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.reject(new Error("Network access is not allowed in this test.")),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listCategories", () => {
  it("returns the shared category definitions in display order", () => {
    const categories = listCategories();

    expect(categories).toEqual(CATEGORIES);
    expect(categories.map((category) => category.slug)).toEqual(
      CATEGORIES.map((category) => category.slug),
    );
  });
});

describe("getCategoryBySlug", () => {
  it("returns the definition for a known slug", () => {
    expect(getCategoryBySlug("gaming")).toEqual(categoryFor("gaming"));
  });

  it("resolves every advertised category", () => {
    for (const category of CATEGORIES) {
      expect(getCategoryBySlug(category.slug)).toEqual(category);
    }
  });

  it("returns null for an unknown slug", () => {
    expect(getCategoryBySlug("does-not-exist")).toBeNull();
    expect(getCategoryBySlug("")).toBeNull();
    expect(getCategoryBySlug("Music")).toBeNull();
  });
});

describe("getCategoryVideos", () => {
  it("returns null for an unknown slug without calling the client", async () => {
    await expect(getCategoryVideos("does-not-exist")).resolves.toBeNull();

    expect(searchVideosMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("forwards the category query and returns the search page", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    await expect(getCategoryVideos("technology")).resolves.toBe(PAGE);

    expect(searchVideosMock).toHaveBeenCalledTimes(1);
    expect(searchVideosMock).toHaveBeenCalledWith({
      query: categoryFor("technology").query,
      pageToken: null,
    });
  });

  it("forwards a page token for the next page", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    await getCategoryVideos("news", { pageToken: "CAoQAA" });

    expect(searchVideosMock).toHaveBeenCalledWith({
      query: categoryFor("news").query,
      pageToken: "CAoQAA",
    });
  });

  it("normalizes an empty page token to null", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    await getCategoryVideos("music", { pageToken: "" });

    expect(searchVideosMock).toHaveBeenCalledWith({
      query: categoryFor("music").query,
      pageToken: null,
    });
  });

  it("rejects a page token with unsafe characters before calling the client", async () => {
    await expect(getCategoryVideos("music", { pageToken: "not a token" })).rejects.toBeInstanceOf(
      DomainValidationError,
    );

    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized page token before calling the client", async () => {
    await expect(
      getCategoryVideos("music", { pageToken: OVERSIZED_PAGE_TOKEN }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("propagates client failures instead of swallowing them", async () => {
    const failure = new Error("upstream failed");
    searchVideosMock.mockRejectedValue(failure);

    await expect(getCategoryVideos("comedy")).rejects.toBe(failure);
  });
});
