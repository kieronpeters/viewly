import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The content component is server-only in production (it awaits `io()` and reads
 * SQLite). Here the feature barrel is replaced with fixtures, `io` becomes a
 * no-op, and `formatWatchTime` stays real so the rendered strings are the ones
 * users see. `server-only` is mocked because `buildWatchHeatmap` imports the
 * feature module's guard.
 */
const { getWatchStatsMock } = vi.hoisted(() => ({
  getWatchStatsMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ io: () => Promise.resolve() }));
vi.mock("@/features/stats", async () => {
  const { formatWatchTime } = await import("@/features/stats/format-watch-time");

  return { getWatchStats: getWatchStatsMock, formatWatchTime };
});

import { buildWatchHeatmap, type WatchStats } from "@/features/stats/watch-stats";

import WatchStatsPage from "./page";
import { StatsPageContent } from "./stats-page-content";

/** Frozen reference point, matching the fixtures' last active day. */
const NOW = new Date("2026-11-10T12:00:00Z");

const HEATMAP = buildWatchHeatmap(
  [
    {
      day: "2026-11-10",
      videosWatched: 1,
      totalViews: 5,
      estimatedWatchSeconds: 5_400,
    },
  ],
  NOW,
);

const STATS: WatchStats = {
  totals: {
    videosWatched: 3,
    totalViews: 9,
    estimatedWatchSeconds: 5_400,
    videosMissingDuration: 1,
  },
  topChannels: [
    {
      channelTitle: "Alpha",
      videosWatched: 2,
      totalViews: 7,
      estimatedWatchSeconds: 5_400,
    },
    {
      channelTitle: "Beta",
      videosWatched: 1,
      totalViews: 2,
      estimatedWatchSeconds: 300,
    },
  ],
  currentStreakDays: 3,
  heatmap: HEATMAP,
};

beforeEach(() => {
  getWatchStatsMock.mockReset();
  getWatchStatsMock.mockReturnValue(STATS);
});

describe("StatsPageContent", () => {
  it("renders the estimated total, count, streak and top channel", async () => {
    render(await StatsPageContent({ now: NOW }));

    expect(screen.getByRole("heading", { name: "Overview", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Total watch time")).toBeInTheDocument();
    expect(screen.getAllByText("1h 30m").length).toBeGreaterThan(0);
    expect(screen.getByText("Estimate")).toBeInTheDocument();
    expect(
      screen.getByText("Estimated as video duration × views; 1 video without a duration excluded."),
    ).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("9 views including repeats")).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
  });

  it("lists top channels with their estimates", async () => {
    render(await StatsPageContent({ now: NOW }));

    expect(screen.getByRole("heading", { name: "Top channels", level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/2 videos · 7 views/)).toBeInTheDocument();
    expect(screen.getByText(/1 video · 2 views/)).toBeInTheDocument();
    expect(screen.getByText("5m")).toBeInTheDocument();
  });

  it("summarises the 12-week heatmap for assistive technology", async () => {
    render(await StatsPageContent({ now: NOW }));

    expect(screen.getByRole("heading", { name: "Last 12 weeks", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /1 active day, 1h 30m estimated/ })).toBeInTheDocument();
    expect(screen.getByText("Each square is one UTC day, oldest first.")).toBeInTheDocument();
  });

  it("shows the empty state on a fresh install", async () => {
    getWatchStatsMock.mockReturnValue({
      totals: {
        videosWatched: 0,
        totalViews: 0,
        estimatedWatchSeconds: 0,
        videosMissingDuration: 0,
      },
      topChannels: [],
      currentStreakDays: 0,
      heatmap: buildWatchHeatmap([], NOW),
    } satisfies WatchStats);

    render(await StatsPageContent({ now: NOW }));

    expect(screen.getByText("No watch stats yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse videos" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("heading", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Top channels" })).not.toBeInTheDocument();
  });

  it("passes the reference clock through to the stats read", async () => {
    render(await StatsPageContent({ now: NOW }));

    expect(getWatchStatsMock).toHaveBeenCalledWith(NOW);
  });
});

describe("Watch stats page shell", () => {
  it("renders the heading and a link back to the library", () => {
    render(<WatchStatsPage />);

    expect(screen.getByRole("heading", { name: "Watch stats", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to library/ })).toHaveAttribute(
      "href",
      "/library",
    );
  });
});
