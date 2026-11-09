// @vitest-environment node
/**
 * Tests for the server-only library reads (T33).
 *
 * A real migrated SQLite file backs the assertions, so "newest first" is the
 * repository's ordering rather than a stub's array. Only the connection lookup
 * is mocked, exactly as the app resolves it from `getDb()`.
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
  favouriteToVideoSummary,
  isInWatchLater,
  isVideoFavourite,
  listFavouriteVideos,
  listWatchLaterVideos,
  watchLaterToVideoSummary,
} from "./library-data";

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
});

afterEach(() => {
  library.dispose();
});

describe("listFavouriteVideos", () => {
  it("returns nothing for an empty library", () => {
    expect(listFavouriteVideos()).toEqual([]);
  });

  it("maps saved rows and keeps the repository's newest-first order", () => {
    saveFavourite("video-oldest", 1_000);
    saveFavourite("video-middle", 2_000);
    saveFavourite("video-newest", 3_000);

    expect(listFavouriteVideos().map((video) => video.id)).toEqual([
      "video-newest",
      "video-middle",
      "video-oldest",
    ]);
  });

  it("maps a stored snapshot to the fields VideoCard renders", () => {
    saveFavourite("dQw4w9WgXcQ", 1_000, {
      title: "Never Gonna Give You Up",
      channelTitle: "Rick Astley",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      durationSeconds: 213,
    });

    const [video] = listFavouriteVideos();

    expect(video).toEqual({
      id: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channelId: "",
      channelTitle: "Rick Astley",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      publishedAt: "",
      durationSeconds: 213,
      viewCount: null,
    });
  });
});

describe("isVideoFavourite", () => {
  it("reflects the stored state", () => {
    saveFavourite("dQw4w9WgXcQ", 1_000);

    expect(isVideoFavourite("dQw4w9WgXcQ")).toBe(true);
    expect(isVideoFavourite("aaaaaaaaaaa")).toBe(false);
  });
});

describe("favouriteToVideoSummary", () => {
  it("keeps a null duration from live or unavailable videos", () => {
    saveFavourite("dQw4w9WgXcQ", 1_000, { durationSeconds: null });

    expect(favouriteToVideoSummary(library.repository.favourites.list()[0])).toMatchObject({
      id: "dQw4w9WgXcQ",
      durationSeconds: null,
    });
  });
});

describe("listWatchLaterVideos", () => {
  it("returns nothing for an empty queue", () => {
    expect(listWatchLaterVideos()).toEqual([]);
  });

  it("maps queued rows and keeps the repository's newest-first order", () => {
    saveWatchLater("video-oldest", 1_000);
    saveWatchLater("video-middle", 2_000);
    saveWatchLater("video-newest", 3_000);

    expect(listWatchLaterVideos().map((video) => video.id)).toEqual([
      "video-newest",
      "video-middle",
      "video-oldest",
    ]);
  });

  it("maps a stored snapshot to the fields VideoCard renders", () => {
    saveWatchLater("dQw4w9WgXcQ", 1_000, {
      title: "Never Gonna Give You Up",
      channelTitle: "Rick Astley",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      durationSeconds: 213,
    });

    expect(listWatchLaterVideos()).toEqual([
      {
        id: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        channelId: "",
        channelTitle: "Rick Astley",
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        publishedAt: "",
        durationSeconds: 213,
        viewCount: null,
      },
    ]);
  });

  it("does not mix in favourites", () => {
    saveFavourite("favourite-video", 1_000);
    saveWatchLater("queued-video", 2_000);

    expect(listWatchLaterVideos().map((video) => video.id)).toEqual(["queued-video"]);
    expect(listFavouriteVideos().map((video) => video.id)).toEqual(["favourite-video"]);
  });
});

describe("isInWatchLater", () => {
  it("reflects the stored state", () => {
    saveWatchLater("dQw4w9WgXcQ", 1_000);

    expect(isInWatchLater("dQw4w9WgXcQ")).toBe(true);
    expect(isInWatchLater("aaaaaaaaaaa")).toBe(false);
  });

  it("is independent of favourites", () => {
    saveFavourite("dQw4w9WgXcQ", 1_000);

    expect(isInWatchLater("dQw4w9WgXcQ")).toBe(false);
  });
});

describe("watchLaterToVideoSummary", () => {
  it("keeps a null duration from live or unavailable videos", () => {
    saveWatchLater("dQw4w9WgXcQ", 1_000, { durationSeconds: null });

    expect(watchLaterToVideoSummary(library.repository.watchLater.list()[0])).toMatchObject({
      id: "dQw4w9WgXcQ",
      durationSeconds: null,
    });
  });
});

/** Fields a seed helper may override on the default snapshot. */
type SnapshotOverrides = {
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  durationSeconds?: number | null;
};

/** Seeds one favourite at a fixed save time. */
function saveFavourite(videoId: string, savedAt: number, overrides: SnapshotOverrides = {}): void {
  library.repository.favourites.add({
    videoId,
    title: `Title ${videoId}`,
    channelTitle: "Channel",
    thumbnailUrl: "https://example.com/thumbnail.jpg",
    durationSeconds: 42,
    ...overrides,
    savedAt: new Date(savedAt),
  });
}

/** Seeds one watch-later entry at a fixed save time. */
function saveWatchLater(videoId: string, savedAt: number, overrides: SnapshotOverrides = {}): void {
  library.repository.watchLater.add({
    videoId,
    title: `Title ${videoId}`,
    channelTitle: "Channel",
    thumbnailUrl: "https://example.com/thumbnail.jpg",
    durationSeconds: 42,
    ...overrides,
    savedAt: new Date(savedAt),
  });
}
