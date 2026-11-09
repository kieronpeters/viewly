// @vitest-environment node
/**
 * Contract tests for the viewing-history Server Actions (T35).
 *
 * The actions run against a real, fully migrated SQLite file supplied through a
 * mocked `getDb`; only `next/cache` is stubbed, because a plain Vitest process
 * has no request context to revalidate. `data/viewly.db` is never opened.
 *
 * `history.recordView` itself (the upsert, the `view_count` SQL increment and
 * the ordering) is covered by the repository and integration suites. These
 * tests pin the action contract on top: validation before any write, one row
 * per video with a fresh `lastViewedAt`, `/library` revalidation, and the two
 * clear paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePathMock, dbHolder } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  /** Replaced with the migrated test client in `beforeEach`. */
  dbHolder: { db: undefined as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/db/client", () => ({ getDb: () => dbHolder.db }));

import { DomainValidationError } from "@/shared/validation";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import { clearAllHistory, clearHistoryEntry, recordView } from "./history-actions";
import type { VideoSnapshot } from "./video-snapshot";

const VIDEO_ID = "dQw4w9WgXcQ";
const OTHER_ID = "aaaaaaaaaaa";

/** A complete, valid snapshot shaped like a normalized `videos.list` item. */
const SNAPSHOT: VideoSnapshot = {
  videoId: VIDEO_ID,
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
  revalidatePathMock.mockReset();
});

afterEach(() => {
  library.dispose();
});

/** Raw row count, independent of the repository under test. */
function countRows(table: "favourites" | "watch_later" | "history"): number {
  const row = library.sqlite.prepare(`select count(*) as count from ${table}`).get() as {
    count: number;
  };

  return row.count;
}

/** Seeds a row with a controlled timestamp, as an earlier view would have. */
function seedView(snapshot: VideoSnapshot, viewedAt: Date) {
  library.repository.history.recordView({ ...snapshot, viewedAt });
}

describe("recordView", () => {
  it("stores one row with the current time and revalidates the library", async () => {
    const before = Date.now();

    await expect(recordView(SNAPSHOT)).resolves.toBeUndefined();

    const after = Date.now();
    const rows = library.repository.history.list();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(SNAPSHOT);
    expect(rows[0]?.viewCount).toBe(1);
    // The action, not the repository, supplies the clock.
    expect(rows[0]?.lastViewedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(rows[0]?.lastViewedAt.getTime()).toBeLessThanOrEqual(after);
    expect(revalidatePathMock.mock.calls).toEqual([["/library"]]);
    // Recording a view never writes to the other library tables.
    expect(countRows("favourites")).toBe(0);
    expect(countRows("watch_later")).toBe(0);
  });

  it("increments the view count and moves lastViewedAt on a repeat view", async () => {
    seedView(SNAPSHOT, new Date("2020-01-01T00:00:00Z"));

    await recordView({ ...SNAPSHOT, title: "  Updated title  ", durationSeconds: 212.8 });

    const rows = library.repository.history.list();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      videoId: VIDEO_ID,
      title: "Updated title",
      durationSeconds: 212,
      viewCount: 2,
    });
    expect(rows[0]?.lastViewedAt.getTime()).toBeGreaterThan(
      new Date("2020-01-01T00:00:00Z").getTime(),
    );
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
  });

  it("keeps one row per video and lists the newest view first", async () => {
    const other: VideoSnapshot = { ...SNAPSHOT, videoId: OTHER_ID, title: "Another video" };

    seedView(other, new Date(1_000));

    await recordView(SNAPSHOT);

    const rows = library.repository.history.list();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.videoId)).toEqual([VIDEO_ID, OTHER_ID]);
    expect(countRows("history")).toBe(2);
  });

  it("rejects an invalid snapshot before writing or revalidating", async () => {
    await expect(recordView({ ...SNAPSHOT, videoId: "not-a-video-id" })).rejects.toBeInstanceOf(
      DomainValidationError,
    );
    await expect(recordView({ ...SNAPSHOT, title: "   " })).rejects.toBeInstanceOf(
      DomainValidationError,
    );
    await expect(
      recordView({ ...SNAPSHOT, thumbnailUrl: "http://example.com/thumb.jpg" }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(countRows("history")).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("clearHistoryEntry", () => {
  it("removes one video, leaves the rest and is safe to repeat", async () => {
    seedView(SNAPSHOT, new Date(1_000));
    seedView({ ...SNAPSHOT, videoId: OTHER_ID }, new Date(2_000));

    await expect(clearHistoryEntry(VIDEO_ID)).resolves.toBeUndefined();

    expect(library.repository.history.list().map((row) => row.videoId)).toEqual([OTHER_ID]);
    expect(revalidatePathMock).toHaveBeenCalledWith("/library");

    // A stale tab can press remove twice; the second press is a no-op.
    await expect(clearHistoryEntry(VIDEO_ID)).resolves.toBeUndefined();
    expect(library.repository.history.list()).toHaveLength(1);
    expect(revalidatePathMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid id before deleting anything", async () => {
    seedView(SNAPSHOT, new Date(1_000));

    await expect(clearHistoryEntry("bad")).rejects.toBeInstanceOf(DomainValidationError);

    expect(library.repository.history.list()).toHaveLength(1);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("clearAllHistory", () => {
  it("empties the history table and leaves the other lists alone", async () => {
    seedView(SNAPSHOT, new Date(1_000));
    seedView({ ...SNAPSHOT, videoId: OTHER_ID }, new Date(2_000));
    library.repository.favourites.add({ ...SNAPSHOT, savedAt: new Date(3_000) });

    await expect(clearAllHistory()).resolves.toBeUndefined();

    expect(countRows("history")).toBe(0);
    expect(countRows("favourites")).toBe(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/library");

    // Clearing an already empty list is a harmless no-op.
    await expect(clearAllHistory()).resolves.toBeUndefined();
    expect(revalidatePathMock).toHaveBeenCalledTimes(2);
  });
});
