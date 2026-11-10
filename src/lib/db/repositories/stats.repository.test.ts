// @vitest-environment node
/**
 * Tests for the stats aggregate query layer (T85).
 *
 * Every assertion runs against a real migrated SQLite file: the estimates,
 * grouping and day projection are SQL behaviour, so stubbing the client would
 * test nothing. `tests/library-db` applies the committed migrations and the
 * repository is used only to seed history rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../../tests/library-db";
import { createStatsRepository, type StatsRepository } from "./stats.repository";

let library: TestLibraryDatabase;
let stats: StatsRepository;

beforeEach(() => {
  library = createTestLibraryDatabase();
  stats = createStatsRepository(library.db);
});

afterEach(() => {
  library.dispose();
});

interface ViewInput {
  channelTitle: string;
  durationSeconds: number | null;
  /** ISO-8601 timestamp; the repository stores UTC milliseconds. */
  viewedAt: string;
  /** Repeat the same view, which bumps `view_count` but not the timestamp. */
  times?: number;
}

/** Seeds one video's history row, optionally with repeat views. */
function view(videoId: string, input: ViewInput) {
  for (let index = 0; index < (input.times ?? 1); index += 1) {
    library.repository.history.recordView({
      videoId,
      title: `Title ${videoId}`,
      channelTitle: input.channelTitle,
      thumbnailUrl: `https://example.com/${videoId}.jpg`,
      durationSeconds: input.durationSeconds,
      viewedAt: new Date(input.viewedAt),
    });
  }
}

describe("totals", () => {
  it("reports zeroes for an empty history", () => {
    expect(stats.totals()).toEqual({
      videosWatched: 0,
      totalViews: 0,
      estimatedWatchSeconds: 0,
      videosMissingDuration: 0,
    });
  });

  it("counts distinct videos and repeat views separately", () => {
    view("video-a", {
      channelTitle: "Alpha",
      durationSeconds: 100,
      viewedAt: "2026-01-10T12:00:00Z",
      times: 3,
    });
    view("video-b", {
      channelTitle: "Alpha",
      durationSeconds: 200,
      viewedAt: "2026-01-11T12:00:00Z",
    });
    view("video-c", {
      channelTitle: "Beta",
      durationSeconds: null,
      viewedAt: "2026-01-11T13:00:00Z",
      times: 2,
    });

    expect(stats.totals()).toEqual({
      videosWatched: 3,
      totalViews: 6,
      // 100 * 3 + 200 * 1; the null duration contributes nothing.
      estimatedWatchSeconds: 500,
      videosMissingDuration: 1,
    });
  });

  it("uses durationSeconds * viewCount as the estimate formula", () => {
    view("video", {
      channelTitle: "Channel",
      durationSeconds: 213,
      viewedAt: "2026-02-01T00:00:00Z",
      times: 5,
    });

    const totals = stats.totals();

    expect(totals.videosWatched).toBe(1);
    expect(totals.totalViews).toBe(5);
    expect(totals.estimatedWatchSeconds).toBe(213 * 5);
  });
});

describe("topChannels", () => {
  it("groups by channel and orders by estimated time, then name", () => {
    view("alpha-old", {
      channelTitle: "Alpha",
      durationSeconds: 100,
      viewedAt: "2026-01-01T00:00:00Z",
    });
    view("alpha-new", {
      channelTitle: "Alpha",
      durationSeconds: 200,
      viewedAt: "2026-01-02T00:00:00Z",
      times: 2,
    });
    view("beta", {
      channelTitle: "Beta",
      durationSeconds: 50,
      viewedAt: "2026-01-03T00:00:00Z",
    });
    // Same estimated time as Beta; the name tie-break puts Gamma first.
    view("gamma", {
      channelTitle: "Gamma",
      durationSeconds: 50,
      viewedAt: "2026-01-04T00:00:00Z",
    });

    expect(stats.topChannels(5)).toEqual([
      {
        channelTitle: "Alpha",
        videosWatched: 2,
        totalViews: 3,
        estimatedWatchSeconds: 500,
      },
      {
        channelTitle: "Beta",
        videosWatched: 1,
        totalViews: 1,
        estimatedWatchSeconds: 50,
      },
      {
        channelTitle: "Gamma",
        videosWatched: 1,
        totalViews: 1,
        estimatedWatchSeconds: 50,
      },
    ]);
  });

  it("honours the limit and returns nothing for zero", () => {
    view("alpha", {
      channelTitle: "Alpha",
      durationSeconds: 100,
      viewedAt: "2026-01-01T00:00:00Z",
    });
    view("beta", {
      channelTitle: "Beta",
      durationSeconds: 50,
      viewedAt: "2026-01-02T00:00:00Z",
    });

    expect(stats.topChannels(1).map((row) => row.channelTitle)).toEqual(["Alpha"]);
    expect(stats.topChannels(0)).toEqual([]);
  });
});

describe("dailyActivity", () => {
  it("buckets rows by UTC day inside a half-open window", () => {
    view("video-a", {
      channelTitle: "Channel",
      durationSeconds: 100,
      viewedAt: "2026-01-10T12:00:00Z",
      times: 3,
    });
    view("video-b", {
      channelTitle: "Channel",
      durationSeconds: 200,
      viewedAt: "2026-01-11T12:00:00Z",
    });
    view("video-c", {
      channelTitle: "Channel",
      durationSeconds: null,
      viewedAt: "2026-01-11T13:00:00Z",
    });
    // Outside the window: the end is exclusive.
    view("video-d", {
      channelTitle: "Channel",
      durationSeconds: 999,
      viewedAt: "2026-01-12T00:00:00Z",
    });

    expect(
      stats.dailyActivity(new Date("2026-01-10T00:00:00Z"), new Date("2026-01-12T00:00:00Z")),
    ).toEqual([
      {
        day: "2026-01-10",
        videosWatched: 1,
        totalViews: 3,
        estimatedWatchSeconds: 300,
      },
      {
        day: "2026-01-11",
        videosWatched: 2,
        totalViews: 2,
        estimatedWatchSeconds: 200,
      },
    ]);
  });

  it("returns no rows for an empty window", () => {
    view("video", {
      channelTitle: "Channel",
      durationSeconds: 100,
      viewedAt: "2026-01-10T12:00:00Z",
    });

    expect(
      stats.dailyActivity(new Date("2026-02-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z")),
    ).toEqual([]);
  });
});

describe("activeDays", () => {
  it("returns distinct UTC days newest first", () => {
    view("video-a", {
      channelTitle: "Channel",
      durationSeconds: 100,
      viewedAt: "2026-01-10T01:00:00Z",
    });
    view("video-b", {
      channelTitle: "Channel",
      durationSeconds: 100,
      viewedAt: "2026-01-10T23:59:59Z",
    });
    view("video-c", {
      channelTitle: "Channel",
      durationSeconds: 100,
      viewedAt: "2026-01-12T00:00:00Z",
    });

    expect(stats.activeDays()).toEqual(["2026-01-12", "2026-01-10"]);
  });

  it("is empty for a fresh install", () => {
    expect(stats.activeDays()).toEqual([]);
  });
});
