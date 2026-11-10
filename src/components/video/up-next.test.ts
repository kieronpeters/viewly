import { describe, expect, it } from "vitest";

import type { VideoSummary } from "@/shared/types";

import { selectUpNextVideo, UP_NEXT_COUNTDOWN_SECONDS } from "./up-next";

function video(id: string): VideoSummary {
  return {
    id,
    title: `Video ${id}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
  };
}

describe("selectUpNextVideo", () => {
  it("uses a five-second countdown", () => {
    expect(UP_NEXT_COUNTDOWN_SECONDS).toBe(5);
  });

  it("returns the first candidate that is not the current video", () => {
    const candidates = [video("current0000"), video("aaaaaaaaaaa"), video("bbbbbbbbbbb")];

    expect(selectUpNextVideo(candidates, "current0000")?.id).toBe("aaaaaaaaaaa");
  });

  it("skips the current video wherever it appears", () => {
    const candidates = [video("aaaaaaaaaaa"), video("current0000"), video("bbbbbbbbbbb")];

    expect(selectUpNextVideo(candidates, "current0000")?.id).toBe("aaaaaaaaaaa");
  });

  it("returns null when the current video is the only candidate", () => {
    expect(selectUpNextVideo([video("current0000")], "current0000")).toBeNull();
    expect(selectUpNextVideo([], "current0000")).toBeNull();
  });
});
