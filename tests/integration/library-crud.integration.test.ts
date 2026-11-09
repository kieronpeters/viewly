// @vitest-environment node
/**
 * Integration tests for the SQLite library CRUD surface (T39).
 *
 * Every test gets its own temporary directory and a database migrated with the
 * committed SQL in `src/db/migrations`; `data/viewly.db` is never opened. The
 * assertions go through `createLibraryRepository` and, where the storage
 * contract matters, through raw SQLite row counts and pragmas, so a repository
 * that silently skipped the database would fail here.
 *
 * These complement `src/lib/db/repositories/library.repository.test.ts`: that
 * suite covers each query in isolation, this one walks whole lifecycles (save ->
 * list -> remove -> cascade) against a freshly migrated file.
 */
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createLibraryRepository,
  type VideoSnapshot,
} from "@/lib/db/repositories/library.repository";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../library-db";

const VIDEO_A = "dQw4w9WgXcQ";
const VIDEO_B = "9bZkp7q19f0";
const VIDEO_C = "kJQP7kiw5Fk";
const VIDEO_D = "JGwWNGJdvx8";

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
});

afterEach(() => {
  library.dispose();
});

/** A complete display snapshot for a fake video. */
function snapshot(videoId: string, overrides: Partial<VideoSnapshot> = {}): VideoSnapshot {
  return {
    videoId,
    title: `Title ${videoId}`,
    channelTitle: "Channel",
    thumbnailUrl: "https://example.com/thumbnail.jpg",
    durationSeconds: 42,
    ...overrides,
  };
}

/** UTC-millisecond timestamp, the unit every `*At` column stores. */
function at(milliseconds: number): Date {
  return new Date(milliseconds);
}

/** Raw row count, so assertions do not depend on the repository's own reads. */
function countRows(
  table: "favourites" | "watch_later" | "history" | "playlists" | "playlist_items",
): number {
  const row = library.sqlite.prepare(`select count(*) as count from ${table}`).get() as {
    count: number;
  };

  return row.count;
}

describe("migrated temporary database", () => {
  it("opens an isolated, fully migrated file with foreign keys enabled", () => {
    expect(library.path.startsWith(library.directory)).toBe(true);
    expect(library.directory.startsWith(tmpdir())).toBe(true);
    expect(library.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);

    const tables = (
      library.sqlite
        .prepare("select name from sqlite_master where type = 'table' order by name")
        .all() as { name: string }[]
    ).map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "__drizzle_migrations",
        "favourites",
        "history",
        "playlist_items",
        "playlists",
        "watch_later",
      ]),
    );

    // The CHECK constraints shipped by the migration are live, not just in the
    // Drizzle schema.
    expect(() =>
      library.sqlite
        .prepare(
          "insert into history (video_id, title, channel_title, thumbnail_url, last_viewed_at, view_count) values ('x', 't', 'c', 'u', 0, -1)",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("creates a separate file for every test database", () => {
    const second = createTestLibraryDatabase();

    try {
      expect(second.path).not.toBe(library.path);
      expect(second.directory).not.toBe(library.directory);
      expect(second.repository.favourites.list()).toEqual([]);
    } finally {
      second.dispose();
    }
  });
});

describe("favourites CRUD", () => {
  it("adds, lists newest first and removes idempotently", () => {
    library.repository.favourites.add({ ...snapshot(VIDEO_A), savedAt: at(1_000) });
    library.repository.favourites.add({ ...snapshot(VIDEO_B), savedAt: at(2_000) });

    expect(library.repository.favourites.list().map((row) => row.videoId)).toEqual([
      VIDEO_B,
      VIDEO_A,
    ]);
    expect(countRows("favourites")).toBe(2);

    expect(library.repository.favourites.remove(VIDEO_A)).toBe(true);
    expect(library.repository.favourites.remove(VIDEO_A)).toBe(false);
    expect(countRows("favourites")).toBe(1);
    expect(library.repository.favourites.isFavourite(VIDEO_A)).toBe(false);
  });

  it("treats a duplicate save as a no-op at the SQLite level", () => {
    const first = library.repository.favourites.add({
      ...snapshot(VIDEO_A, { title: "Original title" }),
      savedAt: at(1_000),
    });

    const duplicate = library.repository.favourites.add({
      ...snapshot(VIDEO_A, { title: "Later title" }),
      savedAt: at(2_000),
    });

    expect(duplicate).toEqual(first);
    expect(duplicate.title).toBe("Original title");
    expect(duplicate.savedAt).toEqual(at(1_000));
    expect(countRows("favourites")).toBe(1);
  });
});

describe("watch later CRUD", () => {
  it("queues, lists newest first and removes idempotently", () => {
    library.repository.watchLater.add({ ...snapshot(VIDEO_A), savedAt: at(1_000) });
    library.repository.watchLater.add({ ...snapshot(VIDEO_B), savedAt: at(2_000) });

    expect(library.repository.watchLater.list().map((row) => row.videoId)).toEqual([
      VIDEO_B,
      VIDEO_A,
    ]);
    expect(library.repository.watchLater.isInWatchLater(VIDEO_A)).toBe(true);
    expect(countRows("watch_later")).toBe(2);

    expect(library.repository.watchLater.remove(VIDEO_B)).toBe(true);
    expect(library.repository.watchLater.remove(VIDEO_B)).toBe(false);
    expect(countRows("watch_later")).toBe(1);
  });

  it("treats a duplicate queue entry as a no-op", () => {
    const first = library.repository.watchLater.add({
      ...snapshot(VIDEO_A, { title: "First snapshot" }),
      savedAt: at(1_000),
    });

    const duplicate = library.repository.watchLater.add({
      ...snapshot(VIDEO_A, { title: "Second snapshot" }),
      savedAt: at(2_000),
    });

    expect(duplicate).toEqual(first);
    expect(duplicate.title).toBe("First snapshot");
    expect(countRows("watch_later")).toBe(1);
  });
});

describe("history CRUD", () => {
  it("records a first view, then upserts the same row and increments the count", () => {
    const first = library.repository.history.recordView({
      ...snapshot(VIDEO_A),
      viewedAt: at(1_000),
    });

    expect(first.viewCount).toBe(1);
    expect(first.lastViewedAt).toEqual(at(1_000));
    expect(countRows("history")).toBe(1);

    const second = library.repository.history.recordView({
      ...snapshot(VIDEO_A, { title: "Refreshed title" }),
      viewedAt: at(2_000),
    });

    expect(second.videoId).toBe(VIDEO_A);
    expect(second.viewCount).toBe(2);
    expect(second.lastViewedAt).toEqual(at(2_000));
    expect(second.title).toBe("Refreshed title");
    expect(countRows("history")).toBe(1);
  });

  it("lists most recently viewed first and clears one or all entries", () => {
    library.repository.history.recordView({ ...snapshot(VIDEO_A), viewedAt: at(1_000) });
    library.repository.history.recordView({ ...snapshot(VIDEO_B), viewedAt: at(2_000) });

    expect(library.repository.history.list().map((row) => row.videoId)).toEqual([VIDEO_B, VIDEO_A]);

    expect(library.repository.history.clearOne(VIDEO_A)).toBe(true);
    expect(library.repository.history.clearOne(VIDEO_A)).toBe(false);
    expect(library.repository.history.list().map((row) => row.videoId)).toEqual([VIDEO_B]);

    expect(library.repository.history.clearAll()).toBe(1);
    expect(library.repository.history.list()).toEqual([]);
    expect(countRows("history")).toBe(0);
    expect(library.repository.history.clearAll()).toBe(0);
  });
});

describe("playlists CRUD", () => {
  it("creates, renames and deletes a playlist", () => {
    const created = library.repository.playlists.create({
      id: "playlist-1",
      name: "Old name",
      createdAt: at(1_000),
      updatedAt: at(1_000),
    });

    expect(created.name).toBe("Old name");
    expect(created.createdAt).toEqual(at(1_000));

    const generated = library.repository.playlists.create({
      name: "Generated id",
      createdAt: at(2_000),
      updatedAt: at(2_000),
    });

    expect(generated.id).not.toBe("playlist-1");
    expect(generated.id).toMatch(/^[0-9a-f-]{36}$/);

    const renamed = library.repository.playlists.rename("playlist-1", "New name", at(3_000));

    expect(renamed?.name).toBe("New name");
    expect(renamed?.createdAt).toEqual(at(1_000));
    expect(renamed?.updatedAt).toEqual(at(3_000));
    expect(library.repository.playlists.rename("missing", "Nope", at(4_000))).toBeUndefined();

    expect(library.repository.playlists.delete("playlist-1")).toBe(true);
    expect(library.repository.playlists.delete("playlist-1")).toBe(false);
    expect(library.repository.playlists.get("playlist-1")).toBeUndefined();
    expect(countRows("playlists")).toBe(1);
  });

  it("appends items in order, no-ops a duplicate add and leaves gaps on removal", () => {
    library.repository.playlists.create({
      id: "playlist-1",
      name: "Queue",
      createdAt: at(1_000),
      updatedAt: at(1_000),
    });

    for (const [videoId, savedAt] of [
      [VIDEO_A, 2_000],
      [VIDEO_B, 3_000],
      [VIDEO_C, 4_000],
    ] as const) {
      library.repository.playlistItems.add({
        playlistId: "playlist-1",
        videoId,
        addedAt: at(savedAt),
      });
    }

    expect(
      library.repository.playlistItems.list("playlist-1").map((item) => item.position),
    ).toEqual([0, 1, 2]);

    const firstB = library.repository.playlistItems.list("playlist-1")[1];
    const duplicateB = library.repository.playlistItems.add({
      playlistId: "playlist-1",
      videoId: VIDEO_B,
      addedAt: at(5_000),
    });

    expect(duplicateB).toEqual(firstB);
    expect(duplicateB?.position).toBe(1);
    expect(duplicateB?.addedAt).toEqual(at(3_000));
    expect(countRows("playlist_items")).toBe(3);

    expect(library.repository.playlistItems.remove("playlist-1", VIDEO_B)).toBe(true);
    expect(library.repository.playlistItems.remove("playlist-1", VIDEO_B)).toBe(false);

    const appended = library.repository.playlistItems.add({
      playlistId: "playlist-1",
      videoId: VIDEO_D,
      addedAt: at(6_000),
    });

    // Positions are append-only: the hole left by VIDEO_B is not compacted.
    expect(appended.position).toBe(3);
    expect(
      library.repository.playlists.get("playlist-1")?.items.map((item) => item.videoId),
    ).toEqual([VIDEO_A, VIDEO_C, VIDEO_D]);
  });

  it("deletes a playlist and cascades its items only", () => {
    for (const id of ["playlist-1", "playlist-2"]) {
      library.repository.playlists.create({
        id,
        name: id,
        createdAt: at(1_000),
        updatedAt: at(1_000),
      });
    }

    library.repository.playlistItems.add({
      playlistId: "playlist-1",
      videoId: VIDEO_A,
      addedAt: at(2_000),
    });
    library.repository.playlistItems.add({
      playlistId: "playlist-2",
      videoId: VIDEO_A,
      addedAt: at(2_000),
    });

    expect(library.repository.playlists.delete("playlist-1")).toBe(true);

    // The cascade is the schema's foreign key, not a manual delete.
    const remaining = library.sqlite.prepare("select playlist_id from playlist_items").all() as {
      playlist_id: string;
    }[];

    expect(remaining).toEqual([{ playlist_id: "playlist-2" }]);
    expect(library.repository.playlistItems.list("playlist-1")).toEqual([]);
    expect(countRows("playlist_items")).toBe(1);
  });

  it("rejects an item for a missing playlist because foreign keys are enforced", () => {
    expect(() =>
      library.repository.playlistItems.add({
        playlistId: "missing",
        videoId: VIDEO_A,
        addedAt: at(1_000),
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);

    expect(countRows("playlist_items")).toBe(0);
  });
});

describe("cross-table independence", () => {
  it("keeps favourites, watch later, history and playlists independent", () => {
    const video = snapshot(VIDEO_A);

    library.repository.favourites.add({ ...video, savedAt: at(1_000) });
    library.repository.watchLater.add({ ...video, savedAt: at(2_000) });
    library.repository.history.recordView({ ...video, viewedAt: at(3_000) });
    library.repository.playlists.create({
      id: "playlist-1",
      name: "Keepers",
      createdAt: at(4_000),
      updatedAt: at(4_000),
    });
    library.repository.playlistItems.add({
      playlistId: "playlist-1",
      videoId: VIDEO_A,
      addedAt: at(5_000),
    });

    library.repository.favourites.remove(VIDEO_A);

    expect(library.repository.favourites.list()).toEqual([]);
    expect(library.repository.watchLater.isInWatchLater(VIDEO_A)).toBe(true);
    expect(library.repository.history.list()).toHaveLength(1);
    expect(library.repository.playlistItems.list("playlist-1")).toHaveLength(1);

    library.repository.playlists.delete("playlist-1");

    expect(library.repository.history.list()).toHaveLength(1);
    expect(library.repository.watchLater.isInWatchLater(VIDEO_A)).toBe(true);
  });
});

describe("repository isolation", () => {
  it("shares the same connection but a separate repository instance", () => {
    library.repository.favourites.add({ ...snapshot(VIDEO_A), savedAt: at(1_000) });

    // A second repository over the same client sees the committed row, which is
    // what a new request would do in production.
    const second = createLibraryRepository(library.db);

    expect(second.favourites.isFavourite(VIDEO_A)).toBe(true);
    expect(second.favourites.list()).toHaveLength(1);
  });
});
