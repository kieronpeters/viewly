import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));

// No network: only the two read functions are replaced. The real error class
// (and its stable codes) is kept so the failure copy is exercised for real.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, getTrending: vi.fn() };
});

vi.mock("@/features/search/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/search/categories")>();
  return { ...actual, getCategoryVideos: vi.fn() };
});

import { CategoryChips } from "@/components/home/category-chips";
import {
  CategorySection,
  TrendingSection,
  getAllCategories,
  getCategoryRowVideos,
  getHomeCategories,
  getTrendingVideos,
} from "@/features/home";
import { getCategoryVideos } from "@/features/search/categories";
import { YouTubeApiError, getTrending } from "@/lib/youtube/client";
import { CATEGORIES } from "@/shared/categories";
import type { SearchPage, VideoSummary } from "@/shared/types";

/** Fixtures mirror normalized `videos.list` items; the UI never sees raw payloads. */
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

const getTrendingMock = vi.mocked(getTrending);
const getCategoryVideosMock = vi.mocked(getCategoryVideos);

function searchPage(items: VideoSummary[]): SearchPage {
  return { items, nextPageToken: null, totalResults: items.length };
}

beforeEach(() => {
  getTrendingMock.mockReset();
  getCategoryVideosMock.mockReset();
  // Any attempt to reach the network is a test bug, not a fallback.
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.reject(new Error("Network access is not allowed in this test.")),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("home data", () => {
  it("asks for trending with the client's default region", async () => {
    getTrendingMock.mockResolvedValue([RICK]);

    await expect(getTrendingVideos()).resolves.toEqual([RICK]);
    expect(getTrendingMock).toHaveBeenCalledWith();
  });

  it("returns an empty row when the category service has no page", async () => {
    getCategoryVideosMock.mockResolvedValue(null);

    await expect(getCategoryRowVideos("music")).resolves.toEqual([]);
  });

  it("selects at least three category rows in display order", () => {
    const categories = getHomeCategories();

    expect(categories.length).toBeGreaterThanOrEqual(3);
    expect(categories.map((category) => category.slug)).toEqual(["music", "gaming", "technology"]);
  });

  it("exposes every shared category for the browse chips", () => {
    const categories = getAllCategories();

    expect(categories).toHaveLength(CATEGORIES.length);
    expect(categories).toEqual(CATEGORIES.map(({ slug, name }) => ({ slug, name })));
  });
});

describe("CategoryChips", () => {
  it("links all eight shared categories to their category pages", () => {
    render(<CategoryChips categories={getAllCategories()} />);

    const nav = screen.getByRole("navigation", { name: "Browse categories" });

    for (const category of CATEGORIES) {
      expect(within(nav).getByRole("link", { name: category.name })).toHaveAttribute(
        "href",
        `/category/${category.slug}`,
      );
    }

    expect(within(nav).getAllByRole("link")).toHaveLength(CATEGORIES.length);
    expect(CATEGORIES).toHaveLength(8);
  });
});

describe("TrendingSection", () => {
  it("renders trending videos as watch cards", async () => {
    getTrendingMock.mockResolvedValue([RICK, CATS]);

    render(await TrendingSection());

    expect(screen.getByRole("heading", { name: "Trending", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Never Gonna Give You Up/ })).toHaveAttribute(
      "href",
      "/watch/dQw4w9WgXcQ",
    );
    expect(screen.getByRole("link", { name: /Keyboard Cat/ })).toHaveAttribute(
      "href",
      "/watch/J---aiyznGQ",
    );
  });

  it("shows an empty state when trending returns nothing", async () => {
    getTrendingMock.mockResolvedValue([]);

    render(await TrendingSection());

    expect(screen.getByText("No trending videos right now")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("CategorySection", () => {
  it("renders a heading for every home category row", async () => {
    const categories = getHomeCategories();
    getCategoryVideosMock.mockResolvedValue(searchPage([CATS]));

    const sections = await Promise.all(
      categories.map((category) => CategorySection({ slug: category.slug, name: category.name })),
    );
    render(<>{sections}</>);

    for (const category of categories) {
      expect(screen.getByRole("heading", { name: category.name, level: 2 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: `View all ${category.name}` })).toHaveAttribute(
        "href",
        `/category/${category.slug}`,
      );
      expect(getCategoryVideosMock).toHaveBeenCalledWith(category.slug);
    }
  });

  it("shows the row's empty state when a category has no videos", async () => {
    getCategoryVideosMock.mockResolvedValue(searchPage([]));

    render(await CategorySection({ slug: "music", name: "Music" }));

    expect(screen.getByRole("heading", { name: "Music", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("No Music videos right now")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="empty-state"]')).not.toBeNull();

    // The row still links to the full category page even when it has no cards.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("View all Music");
    expect(links[0]).toHaveAttribute("href", "/category/music");
  });

  it("keeps the other sections rendering when one section fails", async () => {
    getTrendingMock.mockRejectedValue(
      new YouTubeApiError(
        "network",
        "Could not reach the YouTube API. https://www.googleapis.com/youtube/v3/videos?key=SECRET",
      ),
    );
    getCategoryVideosMock.mockResolvedValue(searchPage([CATS]));

    const trending = await TrendingSection();
    const music = await CategorySection({ slug: "music", name: "Music" });
    render(
      <>
        {trending}
        {music}
      </>,
    );

    // The failed row degrades to an error state, without leaking upstream data.
    expect(screen.getByRole("heading", { name: "Trending", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Trending unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not reach youtube/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/googleapis|SECRET/);

    // The healthy section is unaffected.
    expect(screen.getByRole("heading", { name: "Music", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Keyboard Cat/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all Music" })).toHaveAttribute(
      "href",
      "/category/music",
    );
  });
});
