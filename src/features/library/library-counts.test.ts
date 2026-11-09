// @vitest-environment node
/**
 * Tests for the library tab counts (T37).
 *
 * A real migrated SQLite file backs the assertions, so the totals come from the
 * repository's `COUNT(*)` queries rather than from stubs. Only the connection
 * lookup is mocked, exactly as the app resolves it from `getDb()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbHolder } = vi.hoisted(() => ({
  /** Replaced with the migrated test client in `beforeEach`. */
  dbHolder: { db: undefined as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => dbHolder.db }));

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import { countLibraryEntries } from "./library-counts";

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
});

afterEach(() => {
  library.dispose();
});

/** Seeds one saved video into a snapshot-backed table. */
function saveVideo(videoId: string, savedAt: number) {
  library.repository.favourites.add({
    videoId,
    title: `Title ${videoId}`,
    channelTitle: "Channel",
    thumbnailUrl: `https://example.com/${videoId}.jpg`,
    durationSeconds: 60,
    savedAt: new Date(savedAt),
  });
}

describe("countLibraryEntries", () => {
  it("reports zero for an empty library", () => {
    expect(countLibraryEntries()).toEqual({
      favourites: 0,
      watchLater: 0,
      history: 0,
      playlists: 0,
    });
  });

  it("counts each table independently", () => {
    saveVideo("favourite-a", 1_000);
    saveVideo("favourite-b", 2_000);

    library.repository.watchLater.add({
      videoId: "queued",
      title: "Queued",
      channelTitle: "Channel",
      thumbnailUrl: "https://example.com/queued.jpg",
      durationSeconds: 60,
      savedAt: new Date(1_000),
    });

    // A repeated view bumps the existing row instead of adding one, so history
    // counts distinct videos even though three views were recorded.
    for (const [videoId, viewedAt] of [
      ["watched-a", 1_000],
      ["watched-a", 2_000],
      ["watched-b", 3_000],
    ] as const) {
      library.repository.history.recordView({
        videoId,
        title: `Title ${videoId}`,
        channelTitle: "Channel",
        thumbnailUrl: `https://example.com/${videoId}.jpg`,
        durationSeconds: 60,
        viewedAt: new Date(viewedAt),
      });
    }

    library.repository.playlists.create({
      name: "Road trip",
      createdAt: new Date(1_000),
      updatedAt: new Date(1_000),
    });
    library.repository.playlists.create({
      name: "Lofi beats",
      createdAt: new Date(2_000),
      updatedAt: new Date(2_000),
    });

    expect(countLibraryEntries()).toEqual({
      favourites: 2,
      watchLater: 1,
      history: 2,
      playlists: 2,
    });
  });

  it("follows deletions", () => {
    saveVideo("favourite", 1_000);
    library.repository.favourites.remove("favourite");

    expect(countLibraryEntries().favourites).toBe(0);
  });
});
