// @vitest-environment node
/**
 * Tests for the watch-stats feature (T85).
 *
 * Aggregates come from a real migrated SQLite file; only `getDb()` is replaced,
 * exactly as the app resolves it. The pure helpers (streak, heatmap) are also
 * exercised directly with hand-written days so their edge cases do not depend
 * on seeded rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbHolder } = vi.hoisted(() => ({
  /** Replaced with the migrated test client in `beforeEach`. */
  dbHolder: { db: undefined as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => dbHolder.db }));

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import {
  buildWatchHeatmap,
  computeCurrentStreak,
  getWatchStats,
  HEATMAP_DAYS,
  HEATMAP_WEEKS,
  startOfUtcDay,
} from "./watch-stats";

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
});

afterEach(() => {
  library.dispose();
});

/** A frozen reference point: midday on 10 November 2026, UTC. */
const NOW = new Date("2026-11-10T12:00:00Z");

interface ViewInput {
  channelTitle: string;
  durationSeconds: number | null;
  /** ISO-8601 timestamp. */
  viewedAt: string;
  /** Repeat the same view; bumps `viewCount` only. */
  times?: number;
}

/** Seeds one video's history row. */
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

describe("getWatchStats", () => {
  it("returns an empty 12-week grid for a fresh install", () => {
    const stats = getWatchStats(NOW);

    expect(stats.totals).toEqual({
      videosWatched: 0,
      totalViews: 0,
      estimatedWatchSeconds: 0,
      videosMissingDuration: 0,
    });
    expect(stats.topChannels).toEqual([]);
    expect(stats.currentStreakDays).toBe(0);
    expect(stats.heatmap.days).toHaveLength(HEATMAP_DAYS);
    expect(stats.heatmap.weeks).toHaveLength(HEATMAP_WEEKS);
    expect(stats.heatmap.weeks.every((week) => week.length === 7)).toBe(true);
    expect(stats.heatmap.activeDayCount).toBe(0);
    expect(stats.heatmap.estimatedWatchSeconds).toBe(0);
    expect(stats.heatmap.days.every((day) => day.level === 0)).toBe(true);
    // The window ends today, UTC.
    expect(stats.heatmap.days.at(-1)?.day).toBe("2026-11-10");
    expect(stats.heatmap.days.at(0)?.day).toBe("2026-08-19");
  });

  it("aggregates totals, channels, streak and the heatmap from history", () => {
    view("video-a", {
      channelTitle: "Alpha",
      durationSeconds: 213,
      viewedAt: "2026-11-10T09:00:00Z",
      times: 5,
    });
    view("video-b", {
      channelTitle: "Beta",
      durationSeconds: 60,
      viewedAt: "2026-11-09T09:00:00Z",
    });

    const stats = getWatchStats(NOW);

    expect(stats.totals).toEqual({
      videosWatched: 2,
      totalViews: 6,
      estimatedWatchSeconds: 213 * 5 + 60,
      videosMissingDuration: 0,
    });
    expect(stats.topChannels.map((channel) => channel.channelTitle)).toEqual(["Alpha", "Beta"]);
    expect(stats.currentStreakDays).toBe(2);

    const today = stats.heatmap.days.at(-1);
    const yesterday = stats.heatmap.days.at(-2);

    expect(today).toMatchObject({
      day: "2026-11-10",
      estimatedWatchSeconds: 213 * 5,
      videosWatched: 1,
      totalViews: 5,
      level: 4,
    });
    expect(yesterday).toMatchObject({
      day: "2026-11-09",
      estimatedWatchSeconds: 60,
      videosWatched: 1,
      totalViews: 1,
      level: 1,
    });
    expect(stats.heatmap.activeDayCount).toBe(2);
    expect(stats.heatmap.estimatedWatchSeconds).toBe(213 * 5 + 60);
  });

  it("counts videos without a duration but excludes them from the estimate", () => {
    view("video-a", {
      channelTitle: "Alpha",
      durationSeconds: 100,
      viewedAt: "2026-11-10T09:00:00Z",
      times: 2,
    });
    view("live-stream", {
      channelTitle: "Alpha",
      durationSeconds: null,
      viewedAt: "2026-11-10T10:00:00Z",
      times: 3,
    });

    const stats = getWatchStats(NOW);

    expect(stats.totals).toEqual({
      videosWatched: 2,
      totalViews: 5,
      estimatedWatchSeconds: 200,
      videosMissingDuration: 1,
    });
    expect(stats.topChannels).toEqual([
      {
        channelTitle: "Alpha",
        videosWatched: 2,
        totalViews: 5,
        estimatedWatchSeconds: 200,
      },
    ]);
    expect(stats.heatmap.days.at(-1)?.estimatedWatchSeconds).toBe(200);
  });
});

describe("computeCurrentStreak", () => {
  it.each([
    { days: [] as string[], expected: 0, why: "no activity" },
    { days: ["2026-11-10"], expected: 1, why: "today only" },
    { days: ["2026-11-09"], expected: 1, why: "yesterday still counts" },
    { days: ["2026-11-08"], expected: 0, why: "outside the grace day" },
    { days: ["2026-11-11"], expected: 0, why: "future data is ignored" },
    {
      days: ["2026-11-10", "2026-11-09", "2026-11-08"],
      expected: 3,
      why: "three consecutive days ending today",
    },
    {
      days: ["2026-11-10", "2026-11-08", "2026-11-07"],
      expected: 1,
      why: "a gap stops the run at the latest day",
    },
    {
      days: ["2026-11-08", "2026-11-09", "2026-11-10"],
      expected: 3,
      why: "input order does not matter",
    },
    {
      days: ["2026-11-10", "2026-11-10", "2026-11-09"],
      expected: 2,
      why: "duplicates are collapsed",
    },
    {
      days: ["not-a-day", "2026-11-10"],
      expected: 1,
      why: "malformed days are ignored",
    },
  ])("returns $expected for $why", ({ days, expected }) => {
    expect(computeCurrentStreak(days, NOW)).toBe(expected);
  });
});

describe("buildWatchHeatmap", () => {
  it("fills missing days, keeps the window end-aligned and scales intensity relatively", () => {
    const heatmap = buildWatchHeatmap(
      [
        {
          day: "2026-11-09",
          videosWatched: 1,
          totalViews: 1,
          estimatedWatchSeconds: 50,
        },
        {
          day: "2026-11-10",
          videosWatched: 1,
          totalViews: 2,
          estimatedWatchSeconds: 100,
        },
        // Outside the 12-week window; must be ignored.
        {
          day: "2026-07-01",
          videosWatched: 1,
          totalViews: 1,
          estimatedWatchSeconds: 9_999,
        },
      ],
      NOW,
    );

    expect(heatmap.days).toHaveLength(HEATMAP_DAYS);
    expect(heatmap.days.at(0)?.day).toBe("2026-08-19");
    expect(heatmap.days.at(-1)?.day).toBe("2026-11-10");
    expect(heatmap.maxEstimatedSeconds).toBe(100);
    expect(heatmap.activeDayCount).toBe(2);
    expect(heatmap.estimatedWatchSeconds).toBe(150);
    expect(heatmap.days.at(-1)?.level).toBe(4);
    expect(heatmap.days.at(-2)?.level).toBe(2);
    expect(heatmap.days.at(-3)?.level).toBe(0);
  });

  it("returns 12 full weeks of zeroed days without activity", () => {
    const heatmap = buildWatchHeatmap([], NOW);

    expect(heatmap.weeks).toHaveLength(12);
    expect(heatmap.weeks.flat()).toHaveLength(84);
    expect(heatmap.days.every((day) => day.level === 0)).toBe(true);
    expect(heatmap.maxEstimatedSeconds).toBe(0);
  });
});

describe("startOfUtcDay", () => {
  it("truncates to midnight UTC, not local midnight", () => {
    expect(startOfUtcDay(new Date("2026-11-10T23:59:59.999Z"))).toEqual(
      new Date("2026-11-10T00:00:00.000Z"),
    );
  });
});
