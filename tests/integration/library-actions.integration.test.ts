// @vitest-environment node
/**
 * Integration tests for the `toggleFavourite` Server Action (T39).
 *
 * The action runs against a real, fully migrated SQLite file supplied through a
 * mocked `getDb`; only `next/cache` is stubbed, because a plain Vitest process
 * has no request context to revalidate. `data/viewly.db` is never opened.
 *
 * The T33 suite in `src/features/library/actions.test.ts` already covers the
 * toggle contract. This file adds the integration angle: the write survives in
 * the file and is visible to a second repository instance (what the next request
 * would build), and a favourite toggle leaves the other library tables alone.
 *
 * Watch Later (T34) is being implemented concurrently, so its action is not
 * tested here; the repository it will call is covered in
 * `library-crud.integration.test.ts`.
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

import { toggleFavourite } from "@/features/library/actions";
import type { FavouriteSnapshot } from "@/features/library/favourite-toggle";
import {
  createLibraryRepository,
  type VideoSnapshot,
} from "@/lib/db/repositories/library.repository";
import { DomainValidationError } from "@/shared/validation";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../library-db";

const VIDEO_ID = "dQw4w9WgXcQ";

/** A complete, valid snapshot shaped like a normalized `search.list` item. */
const SNAPSHOT: FavouriteSnapshot = {
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

/** A display snapshot for seeding the non-favourite tables. */
function snapshot(videoId: string): VideoSnapshot {
  return {
    videoId,
    title: `Title ${videoId}`,
    channelTitle: "Channel",
    thumbnailUrl: "https://example.com/thumbnail.jpg",
    durationSeconds: 42,
  };
}

describe("toggleFavourite (integration)", () => {
  it("persists a save and a removal that a new repository instance can see", async () => {
    await expect(toggleFavourite(SNAPSHOT)).resolves.toEqual({ favourited: true });

    // A fresh repository over the same file is what the next request builds.
    const nextRequest = createLibraryRepository(library.db);

    expect(nextRequest.favourites.isFavourite(VIDEO_ID)).toBe(true);
    expect(nextRequest.favourites.list()[0]).toMatchObject(SNAPSHOT);
    expect(countRows("favourites")).toBe(1);
    expect(revalidatePathMock.mock.calls).toEqual([["/library"], [`/watch/${VIDEO_ID}`]]);

    await expect(toggleFavourite(SNAPSHOT)).resolves.toEqual({ favourited: false });

    expect(createLibraryRepository(library.db).favourites.list()).toEqual([]);
    expect(countRows("favourites")).toBe(0);
    expect(revalidatePathMock).toHaveBeenCalledTimes(4);
  });

  it("stores the validated snapshot and leaves watch later and history untouched", async () => {
    library.repository.watchLater.add({ ...snapshot(VIDEO_ID), savedAt: new Date(1_000) });
    library.repository.history.recordView({ ...snapshot(VIDEO_ID), viewedAt: new Date(2_000) });

    await toggleFavourite({ ...SNAPSHOT, title: "  Trimmed title  ", durationSeconds: 212.8 });

    const stored = library.repository.favourites.list()[0];

    expect(stored).toMatchObject({ title: "Trimmed title", durationSeconds: 212 });
    expect(countRows("watch_later")).toBe(1);
    expect(countRows("history")).toBe(1);
    expect(library.repository.history.list()[0]?.viewCount).toBe(1);
  });

  it("rejects invalid input before writing or revalidating", async () => {
    await expect(
      toggleFavourite({ ...SNAPSHOT, videoId: "not-a-video-id" }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(countRows("favourites")).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
