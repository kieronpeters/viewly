import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Search flow contract — `docs/specs/search.md` / `search.json`, specVersion 0.1.0.
 *
 * Same convention as the home contract:
 * - `it(...)` guards behaviour Viewly already satisfies.
 * - `it.fails(...)` asserts a spec requirement Viewly does not meet yet. It passes
 *   while the gap exists and starts failing when the behaviour lands, which forces
 *   a promotion to `it(...)` plus a parity-report update.
 */

const { searchVideosMock } = vi.hoisted(() => ({ searchVideosMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/search",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("q=coastlines"),
}));

// The results component calls the YouTube client in-process; contracts never hit the network.
vi.mock("@/lib/youtube/client", () => ({
  searchVideos: searchVideosMock,
  isYouTubeApiError: (error: unknown) =>
    typeof error === "object" && error !== null && (error as { code?: string }).code === "network",
}));

vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));
vi.mock("@/features/library/playlist-actions", () => ({
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
}));

import { SearchFilters } from "@/components/search/search-filters";
import { SearchForm } from "@/components/search/search-form";
import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";
import { DEFAULT_SEARCH_FILTERS, type SearchFilters as Filters } from "@/shared/search-filters";
import type { SearchPage, VideoSummary } from "@/shared/types";
import { SearchResults } from "@/app/search/search-results";

const VIDEO: VideoSummary = {
  id: "contractSearch1",
  title: "A long-form documentary about coastlines and tides",
  channelId: "contractChannel1",
  channelTitle: "Coastline Films",
  thumbnailUrl: "https://i.ytimg.com/vi/contractSearch1/hqdefault.jpg",
  publishedAt: "2026-10-01T09:00:00Z",
  durationSeconds: 754,
  viewCount: 1_500_000,
};

const PAGE: SearchPage = { items: [VIDEO], nextPageToken: "CAoQAA", totalResults: 1 };

function pageOf(overrides: Partial<SearchPage> = {}): SearchPage {
  return { ...PAGE, ...overrides };
}

const ACTIVE_FILTERS: Filters = { ...DEFAULT_SEARCH_FILTERS, duration: "long", order: "date" };

describe("search contract: query and filters", () => {
  it("exposes a named search landmark with a labelled, prefilled query field", () => {
    render(<SearchForm initialQuery="coastlines" />);

    expect(screen.getByRole("search", { name: "Search videos" })).toBeInTheDocument();
    const field = screen.getByRole("searchbox", { name: "Search videos" });
    expect(field).toHaveValue("coastlines");
    expect(field).toHaveAttribute("name", "q");
  });

  it("labels every filter control and carries the query with each selection", () => {
    render(<SearchFilters query="coastlines" pageToken={null} filters={DEFAULT_SEARCH_FILTERS} />);

    expect(screen.getByRole("combobox", { name: "Duration" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Upload date" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();

    const form = screen.getByRole("form", { name: "Search filters" });
    expect(within(form).getByDisplayValue("coastlines")).toHaveAttribute("name", "q");
  });

  it("offers a way back to unfiltered results only while a filter is active", () => {
    const { rerender } = render(
      <SearchFilters query="coastlines" filters={DEFAULT_SEARCH_FILTERS} />,
    );
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();

    rerender(<SearchFilters query="coastlines" filters={ACTIVE_FILTERS} />);
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/search?q=coastlines",
    );
  });

  it.fails("offers a clear-query control inside the search field", () => {
    // Spec control `clear-query`, named "Clear search query" in the observed surface.
    render(<SearchForm initialQuery="coastlines" />);

    expect(screen.getByRole("button", { name: "Clear search query" })).toBeInTheDocument();
  });
});

describe("search contract: results", () => {
  it("renders a named results region with one watch link per result", async () => {
    searchVideosMock.mockResolvedValueOnce(pageOf());

    render(await SearchResults({ searchParams: Promise.resolve({ q: "coastlines" }) }));

    expect(screen.getByRole("heading", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: VIDEO.title })).toHaveAttribute(
      "href",
      `/watch/${VIDEO.id}`,
    );
  });

  it("announces the wait and keeps the placeholder grid decorative while results load", () => {
    render(<SearchResultsSkeleton />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading search results");

    // The grid of placeholders is decorative; the status text is the announcement.
    const grid = status.querySelector("div.grid");
    expect(grid).not.toBeNull();
    expect(grid).toHaveAttribute("aria-hidden", "true");
    expect(grid?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("offers an explicit load-more control while another page exists", async () => {
    searchVideosMock.mockResolvedValueOnce(pageOf());

    render(await SearchResults({ searchParams: Promise.resolve({ q: "coastlines" }) }));

    expect(screen.getByRole("link", { name: "Load more results" })).toHaveAttribute(
      "href",
      expect.stringContaining("pageToken=CAoQAA"),
    );
  });

  it("renders an authored empty state when the query matches nothing", async () => {
    searchVideosMock.mockResolvedValueOnce(pageOf({ items: [], nextPageToken: null }));

    render(await SearchResults({ searchParams: Promise.resolve({ q: "coastlines" }) }));

    expect(screen.getByRole("heading", { level: 2, name: /No results/ })).toBeInTheDocument();
    expect(screen.getByText("Try a different spelling or fewer words.")).toBeInTheDocument();
  });

  it("announces a failure and offers retry instead of an empty list", async () => {
    searchVideosMock.mockRejectedValueOnce({ code: "network" });

    render(await SearchResults({ searchParams: Promise.resolve({ q: "coastlines" }) }));

    expect(screen.getByRole("alert")).toHaveTextContent(/Could not reach YouTube/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it.fails("presents filter chips as a tablist on the results surface", async () => {
    // Spec control `filter-chips`: role=tab, one selected, refilters in place.
    searchVideosMock.mockResolvedValueOnce(pageOf());

    render(await SearchResults({ searchParams: Promise.resolve({ q: "coastlines" }) }));

    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});

describe("search contract: result rows", () => {
  it("keeps the result title to two lines", async () => {
    searchVideosMock.mockResolvedValueOnce(pageOf());

    render(await SearchResults({ searchParams: Promise.resolve({ q: "coastlines" }) }));

    const heading = screen.getByRole("heading", { level: 3, name: VIDEO.title });
    expect(heading).toHaveClass("line-clamp-2");
  });

  it.fails("exposes a row action menu on every result", async () => {
    // Spec control `row-overflow`.
    searchVideosMock.mockResolvedValueOnce(pageOf());

    render(await SearchResults({ searchParams: Promise.resolve({ q: "coastlines" }) }));

    expect(screen.getByRole("button", { name: /more actions/i })).toBeInTheDocument();
  });
});
