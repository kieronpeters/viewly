// @vitest-environment node
/**
 * Tests for the playback-progress query layer (T68).
 *
 * Every test opens a throwaway SQLite file in a fresh `mkdtemp` directory,
 * applies the real migrations from `src/db/migrations` with the same Drizzle
 * migrator that `npm run db:migrate` uses, and hands that client to
 * `createProgressRepository`. `data/viewly.db` is never opened; the sandbox is
 * deleted after each test (the handle is closed first because Windows will not
 * delete an open file).
 *
 * The repository imports `server-only`, which throws outside a Server Component
 * graph; Vitest is not one, so the package is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createProgressRepository,
  type ProgressRepository,
} from "@/lib/db/repositories/progress.repository";
import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../../tests/library-db";

const VIDEO_ID = "dQw4w9WgXcQ";
const OTHER_ID = "aaaaaaaaaaa";

let library: TestLibraryDatabase;
let repository: ProgressRepository;

/** UTC-millisecond timestamp helper, matching every other `*At` column. */
function at(milliseconds: number): Date {
  return new Date(milliseconds);
}

beforeEach(() => {
  library = createTestLibraryDatabase();
  repository = createProgressRepository(library.db);
});

afterEach(() => {
  library.dispose();
});

/** Raw row count, independent of the repository under test. */
function countRows(): number {
  const row = library.sqlite.prepare("select count(*) as count from video_progress").get() as {
    count: number;
  };

  return row.count;
}

describe("save", () => {
  it("inserts one row and returns it", () => {
    const row = repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 42,
      durationSeconds: 213,
      updatedAt: at(1_700_000_000_000),
    });

    expect(row).toMatchObject({
      videoId: VIDEO_ID,
      positionSeconds: 42,
      durationSeconds: 213,
    });
    expect(row.updatedAt.getTime()).toBe(1_700_000_000_000);
    expect(countRows()).toBe(1);
  });

  it("upserts on the video id instead of adding a second row", () => {
    repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 42,
      durationSeconds: 213,
      updatedAt: at(1_000),
    });

    const updated = repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 100,
      durationSeconds: 213,
      updatedAt: at(2_000),
    });

    expect(updated.positionSeconds).toBe(100);
    expect(updated.updatedAt.getTime()).toBe(2_000);
    expect(countRows()).toBe(1);
    expect(repository.get(VIDEO_ID)?.positionSeconds).toBe(100);
  });

  it("floors and clamps a position past the end", () => {
    const row = repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 999.9,
      durationSeconds: 213.8,
      updatedAt: at(1_000),
    });

    expect(row.positionSeconds).toBe(213);
    expect(row.durationSeconds).toBe(213);
  });

  it("keeps one row per video for different videos", () => {
    repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: at(1_000),
    });
    repository.save({
      videoId: OTHER_ID,
      positionSeconds: 20,
      durationSeconds: 100,
      updatedAt: at(2_000),
    });

    expect(countRows()).toBe(2);
  });
});

describe("get and listForVideos", () => {
  it("returns undefined for a video without progress", () => {
    expect(repository.get(VIDEO_ID)).toBeUndefined();
  });

  it("returns only the requested videos", () => {
    repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: at(1_000),
    });

    expect(repository.listForVideos([VIDEO_ID, OTHER_ID]).map((row) => row.videoId)).toEqual([
      VIDEO_ID,
    ]);
  });

  it("returns an empty array without querying when the input is empty", () => {
    expect(repository.listForVideos([])).toEqual([]);
  });
});

describe("clear", () => {
  it("removes the row and reports whether one existed", () => {
    repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 10,
      durationSeconds: 100,
      updatedAt: at(1_000),
    });

    expect(repository.clear(VIDEO_ID)).toBe(true);
    expect(repository.clear(VIDEO_ID)).toBe(false);
    expect(repository.get(VIDEO_ID)).toBeUndefined();
    expect(countRows()).toBe(0);
  });
});

describe("listContinueWatching", () => {
  /** Seeds the display snapshot every list shares, through the real repository. */
  function addSnapshot(videoId: string, title: string, durationSeconds: number | null = 200) {
    const snapshot = {
      videoId,
      title,
      channelTitle: "Snapshot channel",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      durationSeconds,
    };

    library.repository.history.recordView({ ...snapshot, viewedAt: at(1_000) });
  }

  /** Seeds one progress row at an exact fraction of a 200-second video. */
  function addProgress(videoId: string, positionSeconds: number, updatedAt: number) {
    repository.save({ videoId, positionSeconds, durationSeconds: 200, updatedAt: at(updatedAt) });
  }

  it("selects only the 5%-95% window, newest progress first", () => {
    // 200-second videos, so each position is an exact percentage.
    addSnapshot("below000001", "Below five percent");
    addSnapshot("atmin000001", "Exactly five percent");
    addSnapshot("middle00001", "In the middle");
    addSnapshot("nearend0001", "Near the end");
    addSnapshot("atend000001", "Exactly ninety-five percent");
    addSnapshot("finished001", "Finished");

    addProgress("below000001", 8, 6_000); // 4%
    addProgress("atmin000001", 10, 3_000); // 5%, included
    addProgress("middle00001", 100, 2_000); // 50%, included
    addProgress("nearend0001", 189, 1_000); // 94.5%, included
    addProgress("atend000001", 190, 900); // 95%, excluded
    addProgress("finished001", 200, 800); // 100%, excluded

    const rows = repository.listContinueWatching();

    expect(rows.map((row) => row.videoId)).toEqual(["atmin000001", "middle00001", "nearend0001"]);
    expect(rows.map((row) => row.title)).toEqual([
      "Exactly five percent",
      "In the middle",
      "Near the end",
    ]);
    expect(rows[1]).toMatchObject({
      positionSeconds: 100,
      progressDurationSeconds: 200,
    });
  });

  it("omits progress rows that have no stored snapshot anywhere", () => {
    addSnapshot("withsnap001", "Has a snapshot");
    addProgress("withsnap001", 100, 1_000);
    addProgress("nosnapshot1", 100, 2_000);

    expect(repository.listContinueWatching().map((row) => row.videoId)).toEqual(["withsnap001"]);
  });

  it("uses the history snapshot when a video is in more than one list", () => {
    const videoId = "shared00001";
    addProgress(videoId, 100, 1_000);

    const snapshot = {
      videoId,
      channelTitle: "Channel",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      durationSeconds: 200,
    };

    library.repository.favourites.add({
      ...snapshot,
      title: "Favourite title",
      channelTitle: "Favourite channel",
      savedAt: at(1_000),
    });
    library.repository.watchLater.add({
      ...snapshot,
      title: "Watch later title",
      savedAt: at(1_000),
    });
    library.repository.history.recordView({
      ...snapshot,
      title: "History title",
      channelTitle: "History channel",
      viewedAt: at(1_000),
    });

    const rows = repository.listContinueWatching();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      videoId,
      title: "History title",
      channelTitle: "History channel",
    });
  });

  it("falls back to watch later for the snapshot and keeps a null snapshot duration", () => {
    library.repository.watchLater.add({
      videoId: "lateronly01",
      title: "Only queued",
      channelTitle: "Queued channel",
      thumbnailUrl: "https://i.ytimg.com/vi/lateronly01/mqdefault.jpg",
      durationSeconds: null,
      savedAt: at(1_000),
    });
    addProgress("lateronly01", 100, 1_000);

    expect(repository.listContinueWatching()).toEqual([
      {
        videoId: "lateronly01",
        title: "Only queued",
        channelTitle: "Queued channel",
        thumbnailUrl: "https://i.ytimg.com/vi/lateronly01/mqdefault.jpg",
        durationSeconds: null,
        positionSeconds: 100,
        progressDurationSeconds: 200,
        updatedAt: at(1_000),
      },
    ]);
  });
});

describe("migration constraints", () => {
  it("rejects a duplicate video id at the primary key", () => {
    const insert = library.sqlite.prepare(
      `insert into video_progress (video_id, position_seconds, duration_seconds, updated_at)
       values (?, ?, ?, ?)`,
    );

    insert.run(VIDEO_ID, 10, 100, 1_000);

    expect(() => insert.run(VIDEO_ID, 20, 100, 2_000)).toThrow(
      /UNIQUE constraint failed: video_progress\.video_id/,
    );
  });

  it("rejects a negative position and a non-positive duration", () => {
    const insert = library.sqlite.prepare(
      `insert into video_progress (video_id, position_seconds, duration_seconds, updated_at)
       values (?, ?, ?, ?)`,
    );

    expect(() => insert.run(VIDEO_ID, -1, 100, 1_000)).toThrow(/CHECK constraint failed/);
    expect(() => insert.run(OTHER_ID, 10, 0, 1_000)).toThrow(/CHECK constraint failed/);
  });
});
