// @vitest-environment node
/**
 * Contract tests for the custom-playlist Server Actions (T36).
 *
 * The actions run against a real migrated SQLite file: only `getDb` and
 * `revalidatePath` are mocked. That keeps the assertions about stored rows,
 * ordering and the foreign-key cascade honest, while `next/cache` stays out of a
 * plain Vitest process (there is no request context to revalidate).
 *
 * The database modules are loaded lazily inside each action; Vitest's module
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

import { DomainValidationError, MAX_PLAYLIST_NAME_LENGTH } from "@/shared/validation";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
} from "./playlist-actions";
import type { PlaylistSnapshot } from "./playlists";

/** A complete, valid snapshot shaped like a normalized `videos.list` item. */
const SNAPSHOT: PlaylistSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

const PLAYLIST_ID = "playlist-road-trip";
const CREATED_AT = new Date("2026-01-01T00:00:00Z");

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
  revalidatePathMock.mockReset();
});

afterEach(() => {
  library.dispose();
});

/** Seeds one playlist and returns its row. */
function seedPlaylist(id = PLAYLIST_ID, name = "Road trip") {
  return library.repository.playlists.create({
    id,
    name,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

/** Number of stored items, read through the repository the app uses. */
function itemCount(playlistId = PLAYLIST_ID): number {
  return library.repository.playlistItems.list(playlistId).length;
}

describe("createPlaylist", () => {
  it("stores the trimmed name and revalidates the library list", async () => {
    const result = await createPlaylist("  Road trip  ");

    expect(result.name).toBe("Road trip");
    expect(result.playlistId).toMatch(/^[0-9a-f-]{36}$/);
    expect(library.repository.playlists.get(result.playlistId)?.name).toBe("Road trip");
    expect(revalidatePathMock.mock.calls).toEqual([["/library"]]);
  });

  it("creates an empty playlist", async () => {
    const result = await createPlaylist("Empty");

    expect(library.repository.playlists.get(result.playlistId)?.items).toEqual([]);
    expect(library.repository.playlists.list()).toHaveLength(1);
  });

  it.each([
    ["", "empty_value"],
    ["   ", "empty_value"],
    ["Road\ttrip", "control_characters"],
    ["Road\ntrip", "control_characters"],
    ["Road\u0000trip", "control_characters"],
    ["a".repeat(MAX_PLAYLIST_NAME_LENGTH + 1), "too_long"],
  ])("rejects %j before writing or revalidating", async (name, code) => {
    await expect(createPlaylist(name)).rejects.toBeInstanceOf(DomainValidationError);
    await expect(createPlaylist(name)).rejects.toMatchObject({ code });

    expect(library.repository.playlists.list()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects non-string input", async () => {
    await expect(createPlaylist(42 as unknown as string)).rejects.toBeInstanceOf(
      DomainValidationError,
    );

    expect(library.repository.playlists.list()).toHaveLength(0);
  });
});

describe("renamePlaylist", () => {
  it("renames the playlist, bumps updatedAt and revalidates both readers", async () => {
    seedPlaylist();

    const result = await renamePlaylist(PLAYLIST_ID, "  Summer drive  ");

    expect(result).toEqual({ renamed: true, name: "Summer drive" });
    expect(library.repository.playlists.get(PLAYLIST_ID)?.name).toBe("Summer drive");
    expect(library.repository.playlists.get(PLAYLIST_ID)?.updatedAt.getTime()).toBeGreaterThan(
      CREATED_AT.getTime(),
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/library"],
      [`/library/playlists/${PLAYLIST_ID}`],
    ]);
  });

  it("reports a missing playlist without revalidating", async () => {
    const result = await renamePlaylist("playlist-missing", "New name");

    expect(result).toEqual({ renamed: false, name: "New name" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid name before writing", async () => {
    seedPlaylist();

    await expect(renamePlaylist(PLAYLIST_ID, "Road\ttrip")).rejects.toMatchObject({
      code: "control_characters",
      field: "playlistName",
    });

    expect(library.repository.playlists.get(PLAYLIST_ID)?.name).toBe("Road trip");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid playlist id", async () => {
    await expect(renamePlaylist("   ", "Name")).rejects.toMatchObject({
      code: "empty_value",
      field: "playlistId",
    });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("deletePlaylist", () => {
  it("deletes the playlist, cascades its items and revalidates both readers", async () => {
    seedPlaylist();
    library.repository.playlistItems.add({
      playlistId: PLAYLIST_ID,
      videoId: SNAPSHOT.videoId,
      addedAt: CREATED_AT,
    });

    await expect(deletePlaylist(PLAYLIST_ID)).resolves.toEqual({ deleted: true });

    expect(library.repository.playlists.get(PLAYLIST_ID)).toBeUndefined();
    expect(itemCount()).toBe(0);
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/library"],
      [`/library/playlists/${PLAYLIST_ID}`],
    ]);
  });

  it("reports a missing playlist without revalidating", async () => {
    await expect(deletePlaylist("playlist-missing")).resolves.toEqual({ deleted: false });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("addToPlaylist", () => {
  it("appends a video and revalidates both readers", async () => {
    seedPlaylist();

    const result = await addToPlaylist(PLAYLIST_ID, SNAPSHOT);

    expect(result).toEqual({
      added: true,
      playlistId: PLAYLIST_ID,
      videoId: SNAPSHOT.videoId,
    });
    expect(library.repository.playlistItems.list(PLAYLIST_ID)).toMatchObject([
      { playlistId: PLAYLIST_ID, videoId: SNAPSHOT.videoId, position: 0 },
    ]);
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/library"],
      [`/library/playlists/${PLAYLIST_ID}`],
    ]);
  });

  it("is idempotent: adding the same video twice keeps one row and its position", async () => {
    seedPlaylist();

    await addToPlaylist(PLAYLIST_ID, SNAPSHOT);
    await expect(addToPlaylist(PLAYLIST_ID, SNAPSHOT)).resolves.toMatchObject({ added: true });

    expect(library.repository.playlistItems.list(PLAYLIST_ID)).toMatchObject([
      { videoId: SNAPSHOT.videoId, position: 0 },
    ]);
  });

  it("keeps insertion order through position", async () => {
    seedPlaylist();

    const first = { ...SNAPSHOT, videoId: "aaaaaaaaaaa" };
    const second = { ...SNAPSHOT, videoId: "bbbbbbbbbbb" };
    const third = { ...SNAPSHOT, videoId: "ccccccccccc" };

    await addToPlaylist(PLAYLIST_ID, first);
    await addToPlaylist(PLAYLIST_ID, second);
    await addToPlaylist(PLAYLIST_ID, third);

    expect(library.repository.playlistItems.list(PLAYLIST_ID)).toMatchObject([
      { videoId: first.videoId, position: 0 },
      { videoId: second.videoId, position: 1 },
      { videoId: third.videoId, position: 2 },
    ]);
  });

  it("reports a stale playlist instead of throwing a foreign-key error", async () => {
    await expect(addToPlaylist("playlist-missing", SNAPSHOT)).resolves.toEqual({
      added: false,
      playlistId: "playlist-missing",
      videoId: SNAPSHOT.videoId,
    });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid snapshot before writing", async () => {
    seedPlaylist();

    await expect(
      addToPlaylist(PLAYLIST_ID, { ...SNAPSHOT, videoId: "not-a-video-id" }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(itemCount()).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid playlist id", async () => {
    await expect(addToPlaylist("", SNAPSHOT)).rejects.toMatchObject({
      code: "empty_value",
      field: "playlistId",
    });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("removeFromPlaylist", () => {
  it("removes the video and revalidates both readers", async () => {
    seedPlaylist();
    library.repository.playlistItems.add({
      playlistId: PLAYLIST_ID,
      videoId: SNAPSHOT.videoId,
      addedAt: CREATED_AT,
    });

    await expect(removeFromPlaylist(PLAYLIST_ID, SNAPSHOT.videoId)).resolves.toEqual({
      removed: true,
    });

    expect(itemCount()).toBe(0);
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/library"],
      [`/library/playlists/${PLAYLIST_ID}`],
    ]);
  });

  it("is idempotent: a repeat remove reports false and does not revalidate", async () => {
    seedPlaylist();

    await expect(removeFromPlaylist(PLAYLIST_ID, SNAPSHOT.videoId)).resolves.toEqual({
      removed: false,
    });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid video id", async () => {
    await expect(removeFromPlaylist(PLAYLIST_ID, "short")).rejects.toMatchObject({
      code: "invalid_format",
      field: "videoId",
    });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
