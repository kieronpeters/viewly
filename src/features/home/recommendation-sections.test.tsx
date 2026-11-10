import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The component only needs the request-cached loader; its real implementation
// (database + YouTube) is covered by `recommendations.test.ts`.
vi.mock("./recommendations", () => ({ getRecommendationShelves: vi.fn() }));

import type { VideoSummary } from "@/shared/types";

import { getRecommendationShelves, type RecommendationShelf } from "./recommendations";
import { HOME_RECOMMENDATION_SHELVES, RecommendationShelfSection } from "./recommendation-sections";

const getRecommendationShelvesMock = vi.mocked(getRecommendationShelves);

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

const BECAUSE_SHELF: RecommendationShelf = {
  kind: "because-you-watched",
  title: "Because you watched Never Gonna Give You Up",
  reason: "Based on your most recent view",
  videos: [RICK],
};

const TOP_CHANNELS_SHELF: RecommendationShelf = {
  kind: "top-channels",
  title: "More from your top channels",
  reason: "Channels you watch most: Rick Astley",
  videos: [RICK],
};

beforeEach(() => {
  getRecommendationShelvesMock.mockReset();
});

describe("HOME_RECOMMENDATION_SHELVES", () => {
  it("lists the three shelves once each, in display order", () => {
    expect(HOME_RECOMMENDATION_SHELVES.map((shelf) => shelf.kind)).toEqual([
      "because-you-watched",
      "top-channels",
      "rediscover-favourites",
    ]);

    for (const shelf of HOME_RECOMMENDATION_SHELVES) {
      expect(shelf.skeletonTitle).not.toBe("");
    }
  });
});

describe("RecommendationShelfSection", () => {
  it("renders the requested shelf with its heading, reason and cards", async () => {
    getRecommendationShelvesMock.mockResolvedValue([BECAUSE_SHELF, TOP_CHANNELS_SHELF]);

    render(await RecommendationShelfSection({ kind: "because-you-watched" }));

    expect(
      screen.getByRole("heading", {
        name: "Because you watched Never Gonna Give You Up",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Based on your most recent view")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Never Gonna Give You Up/ })).toHaveAttribute(
      "href",
      "/watch/dQw4w9WgXcQ",
    );
  });

  it("renders only its own shelf, never a sibling's", async () => {
    getRecommendationShelvesMock.mockResolvedValue([BECAUSE_SHELF, TOP_CHANNELS_SHELF]);

    render(await RecommendationShelfSection({ kind: "top-channels" }));

    expect(
      screen.getByRole("heading", { name: "More from your top channels", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Because you watched/ })).not.toBeInTheDocument();
  });

  it("hides the section when its shelf is absent", async () => {
    getRecommendationShelvesMock.mockResolvedValue([TOP_CHANNELS_SHELF]);

    const { container } = render(
      await RecommendationShelfSection({ kind: "rediscover-favourites" }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("hides the section when the loader fails, without rendering the failure", async () => {
    getRecommendationShelvesMock.mockRejectedValue(
      new Error("upstream https://www.googleapis.com/youtube/v3/search?key=SECRET"),
    );

    const { container } = render(await RecommendationShelfSection({ kind: "because-you-watched" }));

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/SECRET|googleapis/);
  });
});
