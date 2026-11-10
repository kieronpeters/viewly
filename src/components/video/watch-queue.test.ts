import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "@/shared/types";

import {
  addQueueItem,
  addVideoToQueue,
  clearVideoQueue,
  getWatchQueue,
  isVideoQueued,
  moveQueueItem,
  moveQueueItemBy,
  moveQueuedVideo,
  parseWatchQueue,
  removeQueueItem,
  removeVideoFromQueue,
  resetWatchQueueCache,
  sanitizeQueueItem,
  selectQueueAutoplayVideo,
  serializeWatchQueue,
  shuffleQueue,
  shuffleQueuedVideos,
  useWatchQueue,
  WATCH_QUEUE_LIMIT,
  WATCH_QUEUE_STORAGE_KEY,
} from "./watch-queue-store";

/** 11-character id, padded so cap tests can generate distinct fixtures. */
function id(index: number): string {
  return `q${String(index).padStart(10, "0")}`;
}

function video(index: number, overrides: Partial<VideoSummary> = {}): VideoSummary {
  const videoId = id(index);

  return {
    id: videoId,
    title: `Video ${index}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
    ...overrides,
  };
}

function ids(queue: readonly VideoSummary[]): string[] {
  return queue.map((item) => item.id);
}

beforeEach(() => {
  window.localStorage.clear();
  resetWatchQueueCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetWatchQueueCache();
});

describe("queue list operations", () => {
  it("appends a video and ignores a duplicate", () => {
    const first = video(1);
    const second = video(2);

    const withFirst = addQueueItem([], first);
    const withSecond = addQueueItem(withFirst, second);

    expect(ids(withSecond)).toEqual([first.id, second.id]);
    // Same reference: a duplicate must not reorder or notify subscribers.
    expect(addQueueItem(withSecond, first)).toBe(withSecond);
  });

  it("never mutates the input list", () => {
    const original = [video(1), video(2)];

    const next = addQueueItem(original, video(3));

    expect(ids(original)).toEqual([id(1), id(2)]);
    expect(ids(next)).toEqual([id(1), id(2), id(3)]);
  });

  it("caps the queue and keeps the newest items", () => {
    let queue: readonly VideoSummary[] = [];

    for (let index = 0; index < WATCH_QUEUE_LIMIT + 5; index += 1) {
      queue = addQueueItem(queue, video(index));
    }

    expect(queue).toHaveLength(WATCH_QUEUE_LIMIT);
    expect(queue[0]?.id).toBe(id(5));
    expect(queue[queue.length - 1]?.id).toBe(id(WATCH_QUEUE_LIMIT + 4));
  });

  it("removes one video and returns the same list for an unknown id", () => {
    const queue = [video(1), video(2), video(3)];

    expect(ids(removeQueueItem(queue, id(2)))).toEqual([id(1), id(3)]);
    expect(removeQueueItem(queue, id(9))).toBe(queue);
  });

  it("moves an item and clamps out-of-range indexes", () => {
    const queue = [video(1), video(2), video(3)];

    expect(ids(moveQueueItem(queue, 0, 2))).toEqual([id(2), id(3), id(1)]);
    expect(ids(moveQueueItem(queue, 2, 0))).toEqual([id(3), id(1), id(2)]);
    expect(ids(moveQueueItem(queue, 1, 99))).toEqual([id(1), id(3), id(2)]);
    expect(moveQueueItem(queue, 1, 1)).toBe(queue);
  });

  it("moves by a delta for the accessible Up/Down controls", () => {
    const queue = [video(1), video(2), video(3)];

    expect(ids(moveQueueItemBy(queue, 2, -1))).toEqual([id(1), id(3), id(2)]);
    expect(ids(moveQueueItemBy(queue, 0, 1))).toEqual([id(2), id(1), id(3)]);
    expect(moveQueueItemBy(queue, 0, -1)).toBe(queue);
    expect(moveQueueItemBy(queue, 2, 1)).toBe(queue);
  });

  it("shuffles deterministically without losing or mutating items", () => {
    const queue = [video(1), video(2), video(3), video(4)];

    // Fisher-Yates with `random()` always 0 swaps every slot with index 0.
    const shuffled = shuffleQueue(queue, () => 0);

    expect(ids(shuffled)).toEqual([id(2), id(3), id(4), id(1)]);
    expect([...ids(shuffled)].sort()).toEqual([id(1), id(2), id(3), id(4)]);
    expect(ids(queue)).toEqual([id(1), id(2), id(3), id(4)]);
    expect(shuffleQueue([video(1)], () => 0)).toHaveLength(1);
  });

  it("reports membership and skips the current video for autoplay", () => {
    const queue = [video(1), video(2)];

    expect(isVideoQueued(queue, id(1))).toBe(true);
    expect(isVideoQueued(queue, id(3))).toBe(false);
    expect(selectQueueAutoplayVideo(queue, id(1))?.id).toBe(id(2));
    expect(selectQueueAutoplayVideo([video(1)], id(1))).toBeNull();
    expect(selectQueueAutoplayVideo([], id(1))).toBeNull();
  });
});

describe("stored queue parsing", () => {
  it("accepts a versioned envelope and a legacy bare array", () => {
    const envelope = JSON.stringify({ version: 1, items: [video(1), video(2)] });

    expect(ids(parseWatchQueue(envelope))).toEqual([id(1), id(2)]);
    expect(ids(parseWatchQueue(JSON.stringify([video(3)])))).toEqual([id(3)]);
  });

  it("returns the shared empty list for missing, malformed or empty storage", () => {
    const empty = parseWatchQueue(null);

    expect(empty).toEqual([]);
    expect(parseWatchQueue("not json")).toBe(empty);
    expect(parseWatchQueue(JSON.stringify({ version: 1, items: [] }))).toBe(empty);
    expect(parseWatchQueue(JSON.stringify({ version: 1, items: "nope" }))).toBe(empty);
  });

  it("drops unsafe or malformed entries and deduplicates ids", () => {
    const raw = JSON.stringify({
      version: 1,
      items: [
        video(1),
        video(1),
        { ...video(2), id: "too-short" },
        { ...video(3), title: "" },
        { ...video(4), thumbnailUrl: "http://example.com/thumb.jpg" },
        { ...video(5), thumbnailUrl: "https://evil.example/thumb.jpg" },
        null,
      ],
    });

    expect(ids(parseWatchQueue(raw))).toEqual([id(1)]);
  });

  it("caps a stored queue at the limit", () => {
    const items = Array.from({ length: WATCH_QUEUE_LIMIT + 3 }, (_, index) => video(index));

    expect(parseWatchQueue(JSON.stringify({ version: 1, items }))).toHaveLength(WATCH_QUEUE_LIMIT);
  });

  it("only stores the queue's own fields", () => {
    const sanitized = sanitizeQueueItem({ ...video(1), description: "private", extra: true });

    expect(sanitized).not.toBeNull();
    expect(sanitized).not.toHaveProperty("description");
    expect(sanitized).not.toHaveProperty("extra");
    expect(serializeWatchQueue([video(1)])).toContain(`"version":1`);
  });
});

describe("queue persistence", () => {
  it("writes additions and reads them back after the cache is dropped", () => {
    addVideoToQueue(video(1));
    addVideoToQueue(video(2));

    expect(window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY)).not.toBeNull();
    expect(ids(getWatchQueue())).toEqual([id(1), id(2)]);

    resetWatchQueueCache();

    expect(ids(getWatchQueue())).toEqual([id(1), id(2)]);
  });

  it("persists removal, moving, shuffling and clearing", () => {
    addVideoToQueue(video(1));
    addVideoToQueue(video(2));
    addVideoToQueue(video(3));

    moveQueuedVideo(2, 0);
    expect(ids(getWatchQueue())).toEqual([id(3), id(1), id(2)]);

    shuffleQueuedVideos(() => 0);
    expect(ids(getWatchQueue())).toEqual([id(1), id(2), id(3)]);

    removeVideoFromQueue(id(2));
    expect(ids(getWatchQueue())).toEqual([id(1), id(3)]);

    clearVideoQueue();
    expect(getWatchQueue()).toEqual([]);
    expect(parseWatchQueue(window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY))).toEqual([]);
  });

  it("keeps working in memory when storage is unavailable", () => {
    const setItem = window.localStorage.setItem;

    window.localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };

    try {
      expect(() => addVideoToQueue(video(1))).not.toThrow();
      expect(ids(getWatchQueue())).toEqual([id(1)]);
    } finally {
      window.localStorage.setItem = setItem;
    }
  });

  it("hydrates the hook from storage and updates every consumer", () => {
    window.localStorage.setItem(WATCH_QUEUE_STORAGE_KEY, serializeWatchQueue([video(1), video(2)]));

    const first = renderHook(() => useWatchQueue());
    const second = renderHook(() => useWatchQueue());

    expect(ids(first.result.current)).toEqual([id(1), id(2)]);

    act(() => {
      removeVideoFromQueue(id(1));
    });

    expect(ids(first.result.current)).toEqual([id(2)]);
    expect(ids(second.result.current)).toEqual([id(2)]);
  });

  it("starts empty when storage is empty", () => {
    const { result } = renderHook(() => useWatchQueue());

    expect(result.current).toEqual([]);
  });
});
