import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));

// Only `searchVideos` is replaced; the real error class and codes stay intact.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, searchVideos: vi.fn() };
});

import { YouTubeApiError, searchVideos } from "@/lib/youtube/client";
import type { SearchPage, VideoSummary } from "@/shared/types";

import { MAX_SUGGESTIONS, getVideoSuggestions, selectVideoSuggestions } from "./video-suggestions";

const searchVideosMock = vi.mocked(searchVideos);

/** Hand-written fixture shaped like a normalized `search.list` item. */
function summary(id: string, overrides: Partial<VideoSummary> = {}): VideoSummary {
  return {
    id,
    title: `Video ${id}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
    ...overrides,
  };
}

function page(items: VideoSummary[]): SearchPage {
  return { items, nextPageToken: null, totalResults: items.length };
}

beforeEach(() => {
  searchVideosMock.mockReset();
});

describe("getVideoSuggestions", () => {
  it("searches for the channel title, capped at the section size", async () => {
    searchVideosMock.mockResolvedValue(page([summary("aaaaaaaaaaa")]));

    const videos = await getVideoSuggestions({
      channelTitle: "Rick Astley",
      currentVideoId: "bbbbbbbbbbb",
    });

    expect(searchVideosMock).toHaveBeenCalledTimes(1);
    expect(searchVideosMock).toHaveBeenCalledWith({
      query: "Rick Astley",
      maxResults: MAX_SUGGESTIONS,
    });
    expect(videos.map((video) => video.id)).toEqual(["aaaaaaaaaaa"]);
  });

  it("trims the channel title before searching", async () => {
    searchVideosMock.mockResolvedValue(page([]));

    await getVideoSuggestions({ channelTitle: "  Rick Astley  ", currentVideoId: "bbbbbbbbbbb" });

    expect(searchVideosMock).toHaveBeenCalledWith({
      query: "Rick Astley",
      maxResults: MAX_SUGGESTIONS,
    });
  });

  it("returns nothing for a blank channel title without calling the client", async () => {
    await expect(
      getVideoSuggestions({ channelTitle: "   ", currentVideoId: "bbbbbbbbbbb" }),
    ).resolves.toEqual([]);

    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("propagates a client failure to the caller", async () => {
    const failure = new YouTubeApiError("quota", "The YouTube API quota has been exceeded.");
    searchVideosMock.mockRejectedValue(failure);

    await expect(
      getVideoSuggestions({ channelTitle: "Rick Astley", currentVideoId: "bbbbbbbbbbb" }),
    ).rejects.toBe(failure);
  });
});

describe("selectVideoSuggestions", () => {
  it("excludes the current video and keeps first-seen order", () => {
    const candidates = [summary("aaaaaaaaaaa"), summary("bbbbbbbbbbb"), summary("ccccccccccc")];

    const selected = selectVideoSuggestions(candidates, "bbbbbbbbbbb");

    expect(selected.map((video) => video.id)).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
  });

  it("de-duplicates by id", () => {
    const candidates = [summary("aaaaaaaaaaa"), summary("aaaaaaaaaaa"), summary("bbbbbbbbbbb")];

    const selected = selectVideoSuggestions(candidates, "ccccccccccc");

    expect(selected.map((video) => video.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  });

  it("caps the result at the limit", () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      summary(`id${String(index).padStart(9, "0")}`),
    );

    const selected = selectVideoSuggestions(candidates, "current0000");

    expect(selected).toHaveLength(MAX_SUGGESTIONS);
    expect(selected.map((video) => video.id)).toEqual(
      candidates.slice(0, MAX_SUGGESTIONS).map((video) => video.id),
    );
  });

  it("skips entries without a usable id or title", () => {
    const candidates = [
      summary("aaaaaaaaaaa", { id: "" }),
      summary("bbbbbbbbbbb", { title: "" }),
      summary("ccccccccccc", { title: "   " }),
      summary("ddddddddddd"),
    ];

    const selected = selectVideoSuggestions(candidates, "current0000");

    expect(selected.map((video) => video.id)).toEqual(["ddddddddddd"]);
  });

  it("returns nothing when the current video is the only candidate", () => {
    expect(selectVideoSuggestions([summary("aaaaaaaaaaa")], "aaaaaaaaaaa")).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const candidates = [summary("aaaaaaaaaaa"), summary("bbbbbbbbbbb")];
    const snapshot = [...candidates];

    selectVideoSuggestions(candidates, "bbbbbbbbbbb");

    expect(candidates).toEqual(snapshot);
  });
});
