import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCategoryBySlugMock, getCategoryVideosMock, notFoundMock } = vi.hoisted(() => ({
  getCategoryBySlugMock: vi.fn(),
  getCategoryVideosMock: vi.fn(),
  // Next's real notFound() throws a control-flow error Next catches; mirror it.
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
// Only the two service calls are replaced, so the page's own composition runs.
vi.mock("@/features/search/categories", () => ({
  getCategoryBySlug: getCategoryBySlugMock,
  getCategoryVideos: getCategoryVideosMock,
}));

import type { SearchPage, VideoSummary } from "@/shared/types";
import { DomainValidationError } from "@/shared/validation";

import { CategoryPageContent, type CategorySearchParams } from "./category-page-content";

const TECHNOLOGY = { slug: "technology", name: "Technology", query: "technology" };

const STANDUP: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "The first ever tech standup",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Viewly Labs",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2024-05-01T12:00:00Z",
  durationSeconds: 213,
  viewCount: 1_500_000,
};

const REVIEW: VideoSummary = {
  id: "J---aiyznGQ",
  title: "Mechanical keyboard review",
  channelId: "UCg2clZ5nQ6Z1J2J1Gd1oWgQ",
  channelTitle: "Charlie's Desk",
  thumbnailUrl: "https://i.ytimg.com/vi/J---aiyznGQ/hqdefault.jpg",
  publishedAt: "2024-04-02T09:30:00Z",
  durationSeconds: 754,
  viewCount: 90_000,
};

function page(overrides: Partial<SearchPage> = {}): SearchPage {
  return { items: [STANDUP, REVIEW], nextPageToken: null, totalResults: 2, ...overrides };
}

/** Invokes the async server component directly, then renders its output. */
async function renderCategory(
  params: { slug: string } = { slug: TECHNOLOGY.slug },
  searchParams: CategorySearchParams = {},
) {
  render(
    await CategoryPageContent({
      params: Promise.resolve(params),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCategoryBySlugMock.mockReturnValue(TECHNOLOGY);
  getCategoryVideosMock.mockResolvedValue(page());
});

describe("CategoryPageContent", () => {
  it("renders the category name and a watch link for every video", async () => {
    await renderCategory();

    expect(screen.getByRole("heading", { level: 1, name: "Technology" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /The first ever tech standup/ })).toHaveAttribute(
      "href",
      "/watch/dQw4w9WgXcQ",
    );
    expect(screen.getByRole("link", { name: /Mechanical keyboard review/ })).toHaveAttribute(
      "href",
      "/watch/J---aiyznGQ",
    );
    expect(getCategoryVideosMock).toHaveBeenCalledWith("technology", { pageToken: null });
  });

  it("keeps heading order at h1 → h2 → h3 above the card titles", async () => {
    await renderCategory();

    expect(screen.getAllByRole("heading").map((heading) => heading.tagName)).toEqual([
      "H1",
      "H2",
      "H3",
      "H3",
    ]);
    expect(
      screen.getByRole("heading", { level: 2, name: "Videos in Technology" }),
    ).toBeInTheDocument();
    // The grid is named by the hidden h2 rather than a separate aria-label.
    expect(screen.getByRole("list", { name: "Videos in Technology" })).toBeInTheDocument();
  });

  it("calls notFound for an unknown slug without fetching videos", async () => {
    getCategoryBySlugMock.mockReturnValue(null);

    await expect(
      CategoryPageContent({
        params: Promise.resolve({ slug: "not-a-category" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(getCategoryVideosMock).not.toHaveBeenCalled();
  });

  it("shows the empty state when the category has no videos", async () => {
    getCategoryVideosMock.mockResolvedValue(page({ items: [], totalResults: 0 }));

    await renderCategory();

    expect(screen.getByRole("heading", { level: 1, name: "Technology" })).toBeInTheDocument();
    expect(screen.getByText("No videos in Technology yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("forwards the page token so the next page can be fetched", async () => {
    await renderCategory({ slug: "technology" }, { pageToken: "CAoQAA" });

    expect(getCategoryVideosMock).toHaveBeenCalledWith("technology", { pageToken: "CAoQAA" });
  });

  it("renders a Load more link that keeps the slug and advances the token", async () => {
    getCategoryVideosMock.mockResolvedValue(page({ nextPageToken: "CAoQAA", totalResults: 100 }));

    await renderCategory();

    const link = screen.getByRole("link", { name: /Load more videos/i });
    const url = new URL(link.getAttribute("href") ?? "", "https://viewly.test");

    expect(url.pathname).toBe("/category/technology");
    expect(url.searchParams.get("pageToken")).toBe("CAoQAA");
  });

  it("omits the Load more link on the last page", async () => {
    getCategoryVideosMock.mockResolvedValue(page({ nextPageToken: null }));

    await renderCategory();

    expect(screen.queryByRole("link", { name: /Load more videos/i })).not.toBeInTheDocument();
  });

  it("recovers from a rejected token by linking back to the first page", async () => {
    getCategoryVideosMock.mockRejectedValue(
      new DomainValidationError(
        "invalid_format",
        "Page token must contain only URL-safe characters.",
        { field: "pageToken" },
      ),
    );

    await renderCategory({ slug: "technology" }, { pageToken: "not a valid token!" });

    expect(screen.getByRole("heading", { level: 1, name: "Technology" })).toBeInTheDocument();
    expect(screen.getByText("That page link is not valid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the first page" })).toHaveAttribute(
      "href",
      "/category/technology",
    );
  });

  it("takes the first value when pageToken is repeated", async () => {
    await renderCategory({ slug: "technology" }, { pageToken: ["CAoQAA", "CBQQAA"] });

    expect(getCategoryVideosMock).toHaveBeenCalledWith("technology", { pageToken: "CAoQAA" });
  });
});
