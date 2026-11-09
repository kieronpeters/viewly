// @vitest-environment node
/**
 * Tests for the client-safe favourites core: snapshot parsing and the
 * repository-backed toggle.
 *
 * The toggle tests run against a real migrated SQLite file, not a stub, so they
 * cover the actual idempotent insert/delete paths the Server Action uses. The
 * action itself is covered separately in `actions.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { VideoSummary } from "@/shared/types";
import { DomainValidationError } from "@/shared/validation";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import {
  favouriteSnapshotFromVideo,
  parseFavouriteSnapshot,
  toggleFavouriteInRepository,
  type FavouriteSnapshot,
} from "./favourite-toggle";

/** A complete, valid snapshot shaped like a normalized `search.list` item. */
const SNAPSHOT: FavouriteSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

/** Fixed save time, so the stored timestamp assertion is exact. */
const SAVED_AT = new Date("2026-01-02T03:04:05.000Z");

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
});

afterEach(() => {
  library.dispose();
});

describe("parseFavouriteSnapshot", () => {
  it("trims text and floors a fractional duration", () => {
    expect(
      parseFavouriteSnapshot({
        ...SNAPSHOT,
        title: "  Never Gonna Give You Up  ",
        channelTitle: "  Rick Astley ",
        durationSeconds: 212.9,
      }),
    ).toEqual({
      ...SNAPSHOT,
      title: "Never Gonna Give You Up",
      channelTitle: "Rick Astley",
      durationSeconds: 212,
    });
  });

  it("accepts an empty channel and a null duration", () => {
    expect(
      parseFavouriteSnapshot({
        ...SNAPSHOT,
        channelTitle: " ",
        durationSeconds: null,
      }),
    ).toEqual({ ...SNAPSHOT, channelTitle: "", durationSeconds: null });
  });

  it.each([
    ["a non-object payload", "not-a-snapshot", null],
    ["a malformed video id", { ...SNAPSHOT, videoId: "too-short" }, "videoId"],
    ["a blank title", { ...SNAPSHOT, title: "   " }, "title"],
    ["a missing title", { ...SNAPSHOT, title: undefined }, "title"],
    ["a non-string channel", { ...SNAPSHOT, channelTitle: 7 }, "channelTitle"],
    [
      "an http thumbnail",
      { ...SNAPSHOT, thumbnailUrl: "http://example.com/t.jpg" },
      "thumbnailUrl",
    ],
    ["a non-URL thumbnail", { ...SNAPSHOT, thumbnailUrl: "not a url" }, "thumbnailUrl"],
    ["a negative duration", { ...SNAPSHOT, durationSeconds: -1 }, "durationSeconds"],
    ["a string duration", { ...SNAPSHOT, durationSeconds: "213" }, "durationSeconds"],
  ])("rejects %s", (_label, input, field) => {
    try {
      parseFavouriteSnapshot(input);
      expect.unreachable("parseFavouriteSnapshot should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).field).toBe(field);
    }
  });
});

describe("favouriteSnapshotFromVideo", () => {
  it("projects only the stored fields out of a video summary", () => {
    const video: VideoSummary = {
      id: SNAPSHOT.videoId,
      title: SNAPSHOT.title,
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
      channelTitle: SNAPSHOT.channelTitle,
      thumbnailUrl: SNAPSHOT.thumbnailUrl,
      publishedAt: "2009-10-25T06:57:33Z",
      durationSeconds: SNAPSHOT.durationSeconds,
      viewCount: 1_500_000,
    };

    expect(favouriteSnapshotFromVideo(video)).toEqual(SNAPSHOT);
  });
});

describe("toggleFavouriteInRepository", () => {
  it("saves a video and reports it as favourited", () => {
    expect(toggleFavouriteInRepository(library.repository, SNAPSHOT, SAVED_AT)).toEqual({
      favourited: true,
    });

    const rows = library.repository.favourites.list();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(SNAPSHOT);
    expect(rows[0].savedAt).toEqual(SAVED_AT);
  });

  it("removes an existing favourite and reports it as not favourited", () => {
    library.repository.favourites.add({ ...SNAPSHOT, savedAt: SAVED_AT });

    expect(toggleFavouriteInRepository(library.repository, SNAPSHOT, SAVED_AT)).toEqual({
      favourited: false,
    });
    expect(library.repository.favourites.list()).toHaveLength(0);
  });

  it("stores the floored duration the parser produced", () => {
    const snapshot = parseFavouriteSnapshot({ ...SNAPSHOT, durationSeconds: 12.99 });

    toggleFavouriteInRepository(library.repository, snapshot, SAVED_AT);

    expect(library.repository.favourites.list()[0].durationSeconds).toBe(12);
  });

  it("leaves a single row when the same video is saved twice", () => {
    library.repository.favourites.add({ ...SNAPSHOT, savedAt: SAVED_AT });
    // A duplicate add is the idempotent path the toggle relies on; the second
    // call must not raise and must keep the original snapshot.
    library.repository.favourites.add({
      ...SNAPSHOT,
      title: "Updated title",
      savedAt: new Date("2026-02-03T04:05:06.000Z"),
    });

    const rows = library.repository.favourites.list();

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe(SNAPSHOT.title);
    expect(rows[0].savedAt).toEqual(SAVED_AT);
  });
});
