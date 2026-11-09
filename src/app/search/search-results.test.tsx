import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));

// No network: only `searchVideos` is replaced, so the real `YouTubeApiError`
// class and its codes are still exercised.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, searchVideos: vi.fn() };
});

// The failure state is a client component that offers `router.refresh()`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SearchResults } from "@/app/search/search-results";
import type { SearchParams } from "@/app/search/search-results";
import { YouTubeApiError, searchVideos } from "@/lib/youtube/client";
import type { SearchPage, VideoSummary } from "@/shared/types";

const RICK: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_500_000,
};

const CATS: VideoSummary = {
  id: "J---aiyznGQ",
  title: "Keyboard Cat",
  channelId: "UCg2clZ5nQ6Z1J2J1Gd1oWgQ",
  channelTitle: "Charlie Schmidt",
  thumbnailUrl: "https://i.ytimg.com/vi/J---aiyznGQ/hqdefault.jpg",
  publishedAt: "2007-06-07T00:00:00Z",
  durationSeconds: 54,
  viewCount: 90_000_000,
};

const searchVideosMock = vi.mocked(searchVideos);

function page(overrides: Partial<SearchPage> = {}): SearchPage {
  return { items: [RICK, CATS], nextPageToken: null, totalResults: 2, ...overrides };
}

/** Invokes the async server component directly, then renders its output. */
async function renderResults(params: SearchParams) {
  const output = await SearchResults({ searchParams: Promise.resolve(params) });
  render(output);
}

beforeEach(() => {
  searchVideosMock.mockReset();
  // Any attempt to reach the network is a test bug, not a fallback.
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.reject(new Error("Network access is not allowed in this test.")),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SearchResults", () => {
  it("renders a title and a watch link for every result", async () => {
    searchVideosMock.mockResolvedValue(page());

    await renderResults({ q: "  rick astley  " });

    expect(screen.getByRole("link", { name: /Never Gonna Give You Up/ })).toHaveAttribute(
      "href",
      "/watch/dQw4w9WgXcQ",
    );
    expect(screen.getByRole("link", { name: /Keyboard Cat/ })).toHaveAttribute(
      "href",
      "/watch/J---aiyznGQ",
    );
    // The query is trimmed once, before it reaches the client.
    expect(searchVideosMock).toHaveBeenCalledWith({ query: "rick astley", pageToken: null });
  });

  it("shows an empty state when the search returns nothing", async () => {
    searchVideosMock.mockResolvedValue(page({ items: [], totalResults: 0 }));

    await renderResults({ q: "rick" });

    expect(screen.getByText(/No results for/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the search prompt when q is missing instead of crashing", async () => {
    await renderResults({});

    expect(screen.getByText("Search Viewly")).toBeInTheDocument();
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("shows the search prompt when q is only whitespace", async () => {
    await renderResults({ q: "   " });

    expect(screen.getByText("Search Viewly")).toBeInTheDocument();
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("forwards a page token so the next page can be fetched", async () => {
    searchVideosMock.mockResolvedValue(page());

    await renderResults({ q: "rick", pageToken: "CAoQAA" });

    expect(searchVideosMock).toHaveBeenCalledWith({ query: "rick", pageToken: "CAoQAA" });
  });

  it("renders a Load more link that keeps the query and advances the token", async () => {
    searchVideosMock.mockResolvedValue(page({ nextPageToken: "CAoQAA", totalResults: 100 }));

    await renderResults({ q: "rick astley" });

    const link = screen.getByRole("link", { name: /Load more results/i });
    const url = new URL(link.getAttribute("href") ?? "", "https://viewly.test");

    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("rick astley");
    expect(url.searchParams.get("pageToken")).toBe("CAoQAA");
  });

  it("omits the Load more link on the last page", async () => {
    searchVideosMock.mockResolvedValue(page({ nextPageToken: null }));

    await renderResults({ q: "rick" });

    expect(screen.queryByRole("link", { name: /Load more results/i })).not.toBeInTheDocument();
  });

  it("renders a safe message when the YouTube quota is exhausted", async () => {
    searchVideosMock.mockRejectedValue(
      new YouTubeApiError(
        "quota",
        "The YouTube API quota has been exceeded. https://www.googleapis.com/youtube/v3/search?key=SECRET",
        { status: 403, reason: "quotaExceeded" },
      ),
    );

    await renderResults({ q: "rick" });

    expect(screen.getByText("Search failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/quota/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/googleapis|SECRET/);
  });

  it("rejects a malformed page token without calling YouTube", async () => {
    await renderResults({ q: "rick", pageToken: "not a valid token!" });

    expect(screen.getByText("That results link is not valid")).toBeInTheDocument();
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("rejects an overlong query without calling YouTube", async () => {
    await renderResults({ q: "a".repeat(101) });

    expect(screen.getByText("That search can't be run")).toBeInTheDocument();
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("takes the first value when a param is repeated", async () => {
    searchVideosMock.mockResolvedValue(page());

    await renderResults({ q: ["rick", "cats"] });

    expect(searchVideosMock).toHaveBeenCalledWith({ query: "rick", pageToken: null });
  });
});
