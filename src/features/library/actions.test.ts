// @vitest-environment node
/**
 * Contract tests for the `toggleFavourite` Server Action (T33).
 *
 * The action runs against a real migrated SQLite file: only `getDb` and
 * `revalidatePath` are mocked. That keeps the assertions about stored state
 * honest, while `next/cache` stays out of a plain Vitest process (there is no
 * request context to revalidate).
 *
 * The database modules are loaded lazily inside the action; Vitest's module
 * mocks intercept dynamic imports too, so `getDb` resolves to the fixture.
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
import { toggleFavourite } from "./actions";
import type { FavouriteSnapshot } from "./favourite-toggle";

/** A complete, valid snapshot shaped like a normalized `search.list` item. */
const SNAPSHOT: FavouriteSnapshot = {
  videoId: "dQw4w9WgXcQ",
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

describe("toggleFavourite", () => {
  it("saves a video, returns only the stored state and revalidates both readers", async () => {
    const result = await toggleFavourite(SNAPSHOT);

    expect(result).toEqual({ favourited: true });
    expect(Object.keys(result)).toEqual(["favourited"]);
    expect(library.repository.favourites.isFavourite(SNAPSHOT.videoId)).toBe(true);
    expect(library.repository.favourites.list()[0]).toMatchObject(SNAPSHOT);

    expect(revalidatePathMock.mock.calls).toEqual([["/library"], [`/watch/${SNAPSHOT.videoId}`]]);
  });

  it("removes a video that is already saved", async () => {
    library.repository.favourites.add({ ...SNAPSHOT, savedAt: new Date("2026-01-01T00:00:00Z") });

    await expect(toggleFavourite(SNAPSHOT)).resolves.toEqual({ favourited: false });

    expect(library.repository.favourites.list()).toHaveLength(0);
    expect(revalidatePathMock).toHaveBeenCalledTimes(2);
  });

  it("toggles back on when the same video is saved again", async () => {
    await toggleFavourite(SNAPSHOT);
    await toggleFavourite(SNAPSHOT);
    await expect(toggleFavourite(SNAPSHOT)).resolves.toEqual({ favourited: true });

    expect(library.repository.favourites.list()).toHaveLength(1);
  });

  it("stores the validated snapshot rather than the raw input", async () => {
    await toggleFavourite({
      ...SNAPSHOT,
      title: "  Never Gonna Give You Up  ",
      durationSeconds: 212.8,
    });

    expect(library.repository.favourites.list()[0]).toMatchObject({
      title: "Never Gonna Give You Up",
      durationSeconds: 212,
    });
  });

  it("rejects invalid input before writing or revalidating", async () => {
    await expect(
      toggleFavourite({ ...SNAPSHOT, videoId: "not-a-video-id" }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(library.repository.favourites.list()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
