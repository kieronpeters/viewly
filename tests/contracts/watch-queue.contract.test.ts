import { beforeEach, describe, expect, it } from "vitest";

import {
  addVideoToQueue,
  clearVideoQueue,
  getWatchQueue,
  parseWatchQueue,
  removeVideoFromQueue,
  resetWatchQueueCache,
} from "@/components/video/watch-queue-store";
import type { VideoSummary } from "@/shared/types";

/**
 * Contract for `docs/specs/watch-queue.md`.
 *
 * The queue's promises are stored-state promises: ordered, unique, removable,
 * clearable and tolerant of junk in storage. The interaction layer above is
 * covered by the component suite.
 */
function video(index: number): VideoSummary {
  const id = `q${String(index).padStart(10, "0")}`;

  return {
    id,
    title: `Video ${index}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetWatchQueueCache();
});

describe("watch queue contract", () => {
  it("keeps queued videos in insertion order", () => {
    addVideoToQueue(video(1));
    addVideoToQueue(video(2));
    addVideoToQueue(video(3));

    expect(getWatchQueue().map((item) => item.id)).toEqual([
      "q0000000001",
      "q0000000002",
      "q0000000003",
    ]);
  });

  it("treats adding the same video twice as a no-op", () => {
    addVideoToQueue(video(1));
    addVideoToQueue(video(1));

    expect(getWatchQueue()).toHaveLength(1);
  });

  it("removes a video by id and ignores unknown ids", () => {
    addVideoToQueue(video(1));
    addVideoToQueue(video(2));

    removeVideoFromQueue("q0000000001");
    removeVideoFromQueue("not-queued1");

    expect(getWatchQueue().map((item) => item.id)).toEqual(["q0000000002"]);
  });

  it("clears every entry", () => {
    addVideoToQueue(video(1));
    addVideoToQueue(video(2));

    clearVideoQueue();

    expect(getWatchQueue()).toEqual([]);
  });

  it("ignores malformed storage instead of throwing", () => {
    window.localStorage.setItem("viewly:watch-queue", "{not json");

    expect(parseWatchQueue("{not json")).toEqual([]);
  });
});
