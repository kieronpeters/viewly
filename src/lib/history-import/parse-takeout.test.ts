import { describe, expect, it } from "vitest";

import { parseTakeoutWatchHistory } from "./parse-takeout";

function entry(overrides: Record<string, unknown>) {
  return {
    header: "YouTube",
    title: "Watched A documentary about tides",
    titleUrl: "https://www.youtube.com/watch?v=contractV01",
    subtitles: [{ name: "Coastline Films", url: "https://www.youtube.com/channel/UC1" }],
    time: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("parseTakeoutWatchHistory", () => {
  it("maps a watched video to the local history shape", () => {
    const [item] = parseTakeoutWatchHistory([entry({})]);

    expect(item).toEqual({
      videoId: "contractV01",
      title: "A documentary about tides",
      channelTitle: "Coastline Films",
      watchedAt: new Date("2026-10-01T10:00:00.000Z"),
    });
  });

  it("skips removed videos, non-video URLs and bad timestamps", () => {
    const items = parseTakeoutWatchHistory([
      entry({ title: "Watched a video that has been removed", titleUrl: undefined }),
      entry({ titleUrl: "https://www.youtube.com/feed/history" }),
      entry({ videoId: undefined, time: "not-a-date" }),
      entry({ time: "not-a-date" }),
    ]);

    expect(items).toHaveLength(0);
  });

  it("deduplicates by video id, keeps the latest watch and sorts newest first", () => {
    const items = parseTakeoutWatchHistory([
      entry({ videoId: undefined, time: "2026-01-01T00:00:00.000Z" }),
      entry({ time: "2026-03-01T00:00:00.000Z" }),
      entry({
        titleUrl: "https://www.youtube.com/watch?v=contractV02",
        title: "Watched Second video",
        time: "2026-02-01T00:00:00.000Z",
      }),
    ]);

    expect(items.map((item) => item.videoId)).toEqual(["contractV01", "contractV02"]);
    expect(items[0]?.watchedAt.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(items[0]?.title).toBe("A documentary about tides");
  });

  it("rejects a file that is not an array", () => {
    expect(() => parseTakeoutWatchHistory({ items: [] })).toThrow("takeout_not_an_array");
  });
});

