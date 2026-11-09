// @vitest-environment node
/**
 * Tests for the server-only history read (T35).
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
import { historyRowToEntry, historyRowToVideoSummary, listHistoryEntries } from "./history-data";

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
});

afterEach(() => {
  library.dispose();
});

/** Fields a seed helper may override on the default snapshot. */
type SnapshotOverrides = {
  title?: string;
  thumbnailUrl?: string;
};

/** Seeds one view at a controlled time. */
function view(videoId: string, viewedAt: number, overrides: SnapshotOverrides = {}) {
  library.repository.history.recordView({
    videoId,
    title: `Title ${videoId}`,
    channelTitle: "Channel",
    thumbnailUrl: `https://example.com/${videoId}.jpg`,
    durationSeconds: 60,
    ...overrides,
    viewedAt: new Date(viewedAt),
  });
}

describe("listHistoryEntries", () => {
  it("returns nothing for an empty history", () => {
    expect(listHistoryEntries()).toEqual([]);
  });

  it("keeps the repository's newest-first order", () => {
    view("video-oldest", 1_000);
    view("video-middle", 2_000);
    view("video-newest", 3_000);

    expect(listHistoryEntries().map((entry) => entry.video.id)).toEqual([
      "video-newest",
      "video-middle",
      "video-oldest",
    ]);
  });

  it("maps a stored snapshot to the fields the card and caption read", () => {
    library.repository.history.recordView({
      videoId: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channelTitle: "Rick Astley",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      durationSeconds: 213,
      viewedAt: new Date("2026-01-01T12:00:00Z"),
    });

    const [entry] = listHistoryEntries();

    expect(entry).toEqual({
      video: {
        id: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        channelId: "",
        channelTitle: "Rick Astley",
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        publishedAt: "",
        durationSeconds: 213,
        viewCount: null,
      },
      lastViewedAt: new Date("2026-01-01T12:00:00Z"),
      viewCount: 1,
    });
  });

  it("keeps one entry per video and surfaces the local view count", () => {
    view("video-repeat", 1_000);
    view("video-repeat", 5_000, { title: "Updated title" });

    const entries = listHistoryEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.video.title).toBe("Updated title");
    expect(entries[0]?.viewCount).toBe(2);
    expect(entries[0]?.lastViewedAt).toEqual(new Date(5_000));
  });
});

describe("history row projections", () => {
  it("maps a row without touching the stored fields", () => {
    view("video-a", 1_000);

    const [row] = library.repository.history.list();

    if (row === undefined) {
      throw new Error("Expected one stored history row.");
    }

    expect(historyRowToVideoSummary(row)).toEqual(historyRowToEntry(row).video);
    expect(historyRowToEntry(row).lastViewedAt).toEqual(row.lastViewedAt);
    expect(historyRowToEntry(row).viewCount).toBe(row.viewCount);
  });
});

describe("thumbnail projection", () => {
  const FALLBACK_THUMBNAIL = "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg";

  it("renders a row on a host next/image rejects with the canonical still", () => {
    view("dQw4w9WgXcQ", 1_000, { thumbnailUrl: "https://example.com/old.jpg" });

    const [entry] = listHistoryEntries();

    expect(entry?.video.thumbnailUrl).toBe(FALLBACK_THUMBNAIL);
  });

  it("leaves the stored row untouched, so the original URL is still there", () => {
    view("dQw4w9WgXcQ", 1_000, { thumbnailUrl: "https://example.com/old.jpg" });

    listHistoryEntries();

    expect(library.repository.history.list()[0]?.thumbnailUrl).toBe("https://example.com/old.jpg");
  });

  it("keeps an allowed stored URL as-is", () => {
    view("dQw4w9WgXcQ", 1_000, {
      thumbnailUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });

    expect(listHistoryEntries()[0]?.video.thumbnailUrl).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });
});
