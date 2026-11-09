// @vitest-environment node
/**
 * Tests for the lazy metadata sweep (T46).
 *
 * A real migrated SQLite file backs every assertion, so "leaves rows
 * unchanged" means the actual `favourites`, `watch_later` and `history` rows,
 * not a stub. The YouTube client is replaced through the sweep's injected
 * `fetchVideos`, so no network call and no API key are involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { VideoSummary } from "@/shared/types";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import {
  LAST_SWEEP_AT_SETTING_KEY,
  SWEEP_BATCH_SIZE,
  SWEEP_INTERVAL_MS,
  UNAVAILABLE_VIDEO_TITLE,
  isSweepDue,
  sweepLibraryMetadata,
} from "./metadata-sweep";

const NOW = new Date("2026-11-10T12:00:00.000Z");

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
});

afterEach(() => {
  library.dispose();
});

describe("settings repository", () => {
  it("round-trips a value, overwrites it and reports an unset key as undefined", () => {
    expect(library.repository.settings.get("missing")).toBeUndefined();

    const first = library.repository.settings.set("last_sweep_at", "2026-01-01", new Date(1_000));

    expect(first).toMatchObject({ key: "last_sweep_at", value: "2026-01-01" });
    expect(first.updatedAt).toEqual(new Date(1_000));
    expect(library.repository.settings.get("last_sweep_at")).toBe("2026-01-01");

    library.repository.settings.set("last_sweep_at", "2026-02-01", new Date(2_000));

    expect(library.repository.settings.get("last_sweep_at")).toBe("2026-02-01");
    expect(
      (
        library.sqlite
          .prepare("select count(*) as count from settings where key = ?")
          .get("last_sweep_at") as { count: number }
      ).count,
    ).toBe(1);
  });
});

describe("isSweepDue", () => {
  it("is due when the marker is absent or unparseable", () => {
    expect(isSweepDue(undefined, NOW)).toBe(true);
    expect(isSweepDue("not a date", NOW)).toBe(true);
  });

  it("treats exactly 30 days as fresh and one millisecond more as due", () => {
    const exactlyThirtyDays = new Date(NOW.getTime() - SWEEP_INTERVAL_MS).toISOString();
    const justOverThirtyDays = new Date(NOW.getTime() - SWEEP_INTERVAL_MS - 1).toISOString();

    expect(isSweepDue(exactlyThirtyDays, NOW)).toBe(false);
    expect(isSweepDue(justOverThirtyDays, NOW)).toBe(true);
  });

  it("treats a future timestamp from clock skew as fresh", () => {
    const future = new Date(NOW.getTime() + SWEEP_INTERVAL_MS).toISOString();

    expect(isSweepDue(future, NOW)).toBe(false);
  });
});

describe("sweepLibraryMetadata", () => {
  it("selects every distinct saved id and refreshes all three tables", async () => {
    const shared = videoId(1);
    const historyOnly = videoId(2);

    saveFavourite(shared, "Old title");
    saveWatchLater(shared, "Old title");
    saveHistory(historyOnly, "Old history title");

    const fetchVideos = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => videoSummary(id, `New title ${id}`)),
    );

    const result = await sweepLibraryMetadata({
      repository: library.repository,
      fetchVideos,
      now: () => NOW,
    });

    expect(result).toEqual({
      status: "completed",
      videoCount: 2,
      refreshedCount: 2,
      unavailableCount: 0,
    });
    expect(fetchVideos).toHaveBeenCalledTimes(1);
    expect(fetchVideos).toHaveBeenCalledWith([shared, historyOnly]);

    expect(library.repository.favourites.list()[0]).toMatchObject({
      videoId: shared,
      title: `New title ${shared}`,
    });
    expect(library.repository.watchLater.list()[0]).toMatchObject({
      videoId: shared,
      title: `New title ${shared}`,
    });
    expect(library.repository.history.list()[0]).toMatchObject({
      videoId: historyOnly,
      title: `New title ${historyOnly}`,
    });
    expect(library.repository.settings.get(LAST_SWEEP_AT_SETTING_KEY)).toBe(NOW.toISOString());
  });

  it("does nothing for 30 days and sweeps once the marker is older", async () => {
    saveFavourite(videoId(1), "Old title");

    const fetchVideos = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => videoSummary(id, "Fresh title")),
    );

    const freshMarker = new Date(NOW.getTime() - SWEEP_INTERVAL_MS).toISOString();
    library.repository.settings.set(LAST_SWEEP_AT_SETTING_KEY, freshMarker, NOW);

    const skipped = await sweepLibraryMetadata({
      repository: library.repository,
      fetchVideos,
      now: () => NOW,
    });

    expect(skipped.status).toBe("skipped");
    expect(fetchVideos).not.toHaveBeenCalled();
    expect(library.repository.favourites.list()[0]?.title).toBe("Old title");
    expect(library.repository.settings.get(LAST_SWEEP_AT_SETTING_KEY)).toBe(freshMarker);

    // One millisecond past the window is due.
    const staleMarker = new Date(NOW.getTime() - SWEEP_INTERVAL_MS - 1).toISOString();
    library.repository.settings.set(LAST_SWEEP_AT_SETTING_KEY, staleMarker, NOW);

    const swept = await sweepLibraryMetadata({
      repository: library.repository,
      fetchVideos,
      now: () => NOW,
    });

    expect(swept.status).toBe("completed");
    expect(fetchVideos).toHaveBeenCalledTimes(1);
    expect(library.repository.favourites.list()[0]?.title).toBe("Fresh title");
  });

  it("batches ids at 50 per request", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => videoId(index + 1));
    for (const id of ids) {
      saveFavourite(id, `Old ${id}`);
    }

    const batches: string[][] = [];
    const fetchVideos = vi.fn(async (batch: readonly string[]) => {
      batches.push([...batch]);

      return batch.map((id) => videoSummary(id, `New ${id}`));
    });

    const result = await sweepLibraryMetadata({
      repository: library.repository,
      fetchVideos,
      now: () => NOW,
    });

    expect(result).toMatchObject({ status: "completed", videoCount: 120, refreshedCount: 120 });
    expect(batches.map((batch) => batch.length)).toEqual([SWEEP_BATCH_SIZE, SWEEP_BATCH_SIZE, 20]);
    expect(batches.flat()).toEqual(ids);
    expect(library.repository.favourites.list().every((row) => row.title.startsWith("New "))).toBe(
      true,
    );
  });

  it("replaces a missing video's snapshot with the placeholder and keeps the saved row", async () => {
    const missing = videoId(1);
    const present = videoId(2);

    saveFavourite(missing, "Stale favourite");
    saveWatchLater(missing, "Stale watch later");
    saveHistory(missing, "Stale history");
    saveFavourite(present, "Stale present");

    const result = await sweepLibraryMetadata({
      repository: library.repository,
      fetchVideos: async (ids) => ids.filter((id) => id === present).map((id) => videoSummary(id)),
      now: () => NOW,
    });

    expect(result).toMatchObject({ status: "completed", videoCount: 2, unavailableCount: 1 });

    const unavailable = {
      videoId: missing,
      title: UNAVAILABLE_VIDEO_TITLE,
      channelTitle: "",
      thumbnailUrl: `https://i.ytimg.com/vi/${missing}/mqdefault.jpg`,
      durationSeconds: null,
    };

    expect(library.repository.favourites.list()).toEqual(
      expect.arrayContaining([expect.objectContaining(unavailable)]),
    );
    expect(library.repository.watchLater.list()).toEqual(
      expect.arrayContaining([expect.objectContaining(unavailable)]),
    );
    expect(library.repository.history.list()).toEqual(
      expect.arrayContaining([expect.objectContaining(unavailable)]),
    );

    // The id is still saved in every list; nothing was deleted.
    expect(library.repository.favourites.count()).toBe(2);
    expect(library.repository.watchLater.count()).toBe(1);
    expect(library.repository.history.count()).toBe(1);
  });

  it("leaves every row and last_sweep_at unchanged when a later batch fails", async () => {
    const ids = Array.from({ length: 60 }, (_, index) => videoId(index + 1));
    for (const id of ids) {
      saveFavourite(id, `Old ${id}`);
    }

    let calls = 0;
    const fetchVideos = vi.fn(async (batch: readonly string[]) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("quota exceeded");
      }

      return batch.map((id) => videoSummary(id, `New ${id}`));
    });

    const result = await sweepLibraryMetadata({
      repository: library.repository,
      fetchVideos,
      now: () => NOW,
    });

    expect(result).toMatchObject({ status: "failed", refreshedCount: 0, unavailableCount: 0 });
    expect(fetchVideos).toHaveBeenCalledTimes(2);

    // Fetching happens before writing, so the first successful batch must not
    // have been applied.
    const rows = library.repository.favourites.list();
    expect(rows).toHaveLength(60);
    expect(rows.every((row) => row.title.startsWith("Old "))).toBe(true);
    expect(library.repository.settings.get(LAST_SWEEP_AT_SETTING_KEY)).toBeUndefined();
  });

  it("records an empty library as a completed sweep", async () => {
    const fetchVideos = vi.fn(async () => []);

    const result = await sweepLibraryMetadata({
      repository: library.repository,
      fetchVideos,
      now: () => NOW,
    });

    expect(result).toEqual({
      status: "completed",
      videoCount: 0,
      refreshedCount: 0,
      unavailableCount: 0,
    });
    expect(fetchVideos).not.toHaveBeenCalled();
    expect(library.repository.settings.get(LAST_SWEEP_AT_SETTING_KEY)).toBe(NOW.toISOString());
  });
});

/** Stable 11-character video id accepted by the YouTube id contract. */
function videoId(index: number): string {
  return `vid${String(index).padStart(8, "0")}`;
}

function videoSummary(id: string, title = `Title ${id}`): VideoSummary {
  return {
    id,
    title,
    channelId: "channel",
    channelTitle: "Channel",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2026-01-01T00:00:00Z",
    durationSeconds: 90,
    viewCount: 1,
  };
}

function saveFavourite(id: string, title: string): void {
  library.repository.favourites.add({
    videoId: id,
    title,
    channelTitle: "Old channel",
    thumbnailUrl: "https://example.com/old.jpg",
    durationSeconds: 1,
    savedAt: new Date(1_000),
  });
}

function saveWatchLater(id: string, title: string): void {
  library.repository.watchLater.add({
    videoId: id,
    title,
    channelTitle: "Old channel",
    thumbnailUrl: "https://example.com/old.jpg",
    durationSeconds: 1,
    savedAt: new Date(1_000),
  });
}

function saveHistory(id: string, title: string): void {
  library.repository.history.recordView({
    videoId: id,
    title,
    channelTitle: "Old channel",
    thumbnailUrl: "https://example.com/old.jpg",
    durationSeconds: 1,
    viewedAt: new Date(1_000),
  });
}
