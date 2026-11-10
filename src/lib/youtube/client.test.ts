import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` deliberately throws when imported outside a Server Component
// graph; Vitest is not one, so the marker module is mocked here.
vi.mock("server-only", () => ({}));

import {
  MAX_COMMENT_RESULTS_LIMIT,
  MAX_RESULTS_LIMIT,
  YouTubeApiError,
  clearYouTubeCache,
  getChannel,
  getTrending,
  getVideo,
  getVideos,
  isYouTubeApiError,
  listComments,
  listPlaylistItems,
  searchVideos,
} from "@/lib/youtube/client";
import { YOUTUBE_CACHE_TTLS_MS } from "@/lib/youtube/cache";
import { DomainValidationError } from "@/shared/validation";

// The real trending route handler, used by the contract test at the end of this
// file. `route.test.ts` mocks `getTrending`, so only this suite can prove what
// the real client actually serialises.
import { GET as getTrendingRoute } from "@/app/api/trending/route";

/** Credential-shaped fake used only to prove the key stays in the request URL. */
const FAKE_KEY = "AIzaSyFAKE-client-test-key-000000";
const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

const VIDEO_ID = "dQw4w9WgXcQ";
const CHANNEL_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";
const OTHER_CHANNEL_ID = "UCaaaaaaaaaaaaaaaaaaaaaa";
const UPLOADS_PLAYLIST_ID = "UUuAXFkgsw1L7xaCfnd5JJOw";
const SEARCH_QUERY = "never gonna give you up";

/**
 * Snippet description carried by every fake `videos.list` item. Real responses
 * always include one, so list endpoints must prove they strip it while the
 * detail endpoint keeps it.
 */
const DESCRIPTION_TEXT = "Official music video. Never gonna give you up.";

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function setKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.YOUTUBE_API_KEY;
  } else {
    process.env.YOUTUBE_API_KEY = value;
  }
}

/** Minimal `videos.list` item, shaped like the real API. */
function videoItem(id: string): Record<string, unknown> {
  return {
    kind: "youtube#video",
    id,
    snippet: {
      title: "Never Gonna Give You Up",
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
      channelTitle: "Rick Astley",
      publishedAt: "2009-10-25T06:57:33Z",
      description: DESCRIPTION_TEXT,
      thumbnails: {
        high: {
          url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          width: 480,
          height: 360,
        },
      },
    },
    contentDetails: { duration: "PT3M33S" },
    statistics: { viewCount: "1500000000" },
  };
}

/** Minimal `search.list` item for a video. */
function searchItem(id: string): Record<string, unknown> {
  const item = videoItem(id);
  return {
    kind: "youtube#video",
    id: { kind: "youtube#video", videoId: id },
    snippet: item.snippet,
  };
}

function searchPayload(items: readonly unknown[]): Record<string, unknown> {
  return {
    kind: "youtube#searchListResponse",
    nextPageToken: "CAoQAA",
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
  };
}

function videoPayload(items: readonly unknown[]): Record<string, unknown> {
  return {
    kind: "youtube#videoListResponse",
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
  };
}

/** Minimal `channels.list` item. */
function channelItem(id: string): Record<string, unknown> {
  return {
    kind: "youtube#channel",
    id,
    snippet: {
      title: "Rick Astley",
      description: "The official Rick Astley channel.",
      thumbnails: {
        high: { url: "https://yt3.ggpht.com/channel-high=s800" },
      },
    },
    statistics: { subscriberCount: "4200000", hiddenSubscriberCount: false },
    contentDetails: { relatedPlaylists: { uploads: UPLOADS_PLAYLIST_ID } },
  };
}

function channelPayload(items: readonly unknown[]): Record<string, unknown> {
  return {
    kind: "youtube#channelListResponse",
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
  };
}

/** Minimal `playlistItems.list` item for a channel uploads page. */
function playlistItem(videoId: string): Record<string, unknown> {
  return {
    kind: "youtube#playlistItem",
    id: `playlist-item-${videoId}`,
    snippet: {
      publishedAt: "2026-01-02T03:04:05Z",
      channelId: CHANNEL_ID,
      title: "A recent upload",
      description: "Not rendered by a card.",
      channelTitle: "Rick Astley",
      thumbnails: {
        high: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
      },
      resourceId: { kind: "youtube#video", videoId },
    },
    contentDetails: { videoId, videoPublishedAt: "2026-01-02T03:04:05Z" },
  };
}

function playlistPayload(items: readonly unknown[]): Record<string, unknown> {
  return {
    kind: "youtube#playlistItemListResponse",
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
  };
}

/** Minimal `commentThreads.list` item for a top-level comment. */
function commentThread(id: string): Record<string, unknown> {
  return {
    kind: "youtube#commentThread",
    id: `thread-${id}`,
    snippet: {
      videoId: VIDEO_ID,
      totalReplyCount: 2,
      topLevelComment: {
        kind: "youtube#comment",
        id,
        snippet: {
          authorDisplayName: "Ada Lovelace",
          textOriginal: "Great video!",
          likeCount: 12,
          publishedAt: "2026-01-02T03:04:05Z",
        },
      },
    },
  };
}

function commentPayload(
  items: readonly unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "youtube#commentThreadListResponse",
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
    ...extra,
  };
}

function apiErrorPayload(status: number, reason: string): Record<string, unknown> {
  return {
    error: {
      code: status,
      message: "Upstream detail that must not be forwarded verbatim.",
      errors: [{ message: "Upstream detail", domain: "youtube.quota", reason }],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Returns the URL passed to the Nth fetch call. */
function requestUrl(callIndex = 0): URL {
  const call = fetchMock.mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`Expected fetch call #${callIndex}, but it was not made.`);
  }

  const [input] = call;
  if (!(input instanceof URL)) {
    throw new Error("Expected the client to call fetch with a URL instance.");
  }

  return input;
}

async function readThrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the callback to reject.");
}

function expectApiError(error: unknown, code: string): YouTubeApiError {
  expect(error).toBeInstanceOf(YouTubeApiError);
  if (!(error instanceof YouTubeApiError)) {
    throw new Error("Unreachable: the error is not a YouTubeApiError.");
  }

  expect(error.code).toBe(code);
  expect(isYouTubeApiError(error)).toBe(true);
  return error;
}

beforeEach(() => {
  setKey(FAKE_KEY);
  clearYouTubeCache();
  delete process.env.YOUTUBE_CACHE_DISABLED;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setKey(ORIGINAL_KEY);
  delete process.env.YOUTUBE_CACHE_DISABLED;
  clearYouTubeCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchVideos", () => {
  it("sends the key only in the request URL and never in the results", async () => {
    fetchMock.mockResolvedValue(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    const page = await searchVideos({ query: SEARCH_QUERY });

    const url = requestUrl();
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.pathname).toBe("/youtube/v3/search");
    expect(url.searchParams.get("key")).toBe(FAKE_KEY);
    expect(url.toString()).toContain(`key=${FAKE_KEY}`);
    expect(url.searchParams.get("type")).toBe("video");
    expect(url.searchParams.get("q")).toBe(SEARCH_QUERY);

    expect(JSON.stringify(page)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(page)).not.toContain("key=");
    expect(page.items).toHaveLength(1);
  });

  it("maps video items and drops channels and playlists", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        searchPayload([
          searchItem(VIDEO_ID),
          {
            kind: "youtube#channel",
            id: { kind: "youtube#channel", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" },
            snippet: { title: "Rick Astley", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" },
          },
          {
            kind: "youtube#playlist",
            id: { kind: "youtube#playlist", playlistId: "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI" },
            snippet: { title: "A playlist", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" },
          },
        ]),
      ),
    );

    const page = await searchVideos({ query: SEARCH_QUERY });

    expect(page.items).toHaveLength(1);
    expect(page.nextPageToken).toBe("CAoQAA");
    expect(page.totalResults).toBe(3);
    expect(page.items[0]).toMatchObject({
      id: VIDEO_ID,
      title: "Never Gonna Give You Up",
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
      channelTitle: "Rick Astley",
      publishedAt: "2009-10-25T06:57:33Z",
      // search.list returns snippet only, so these are absent by design.
      durationSeconds: null,
      viewCount: null,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
  });

  it("caps maxResults at 50 and floors it at 1", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({ query: SEARCH_QUERY, maxResults: 500 });
    await searchVideos({ query: SEARCH_QUERY, maxResults: 0 });

    expect(requestUrl(0).searchParams.get("maxResults")).toBe(String(MAX_RESULTS_LIMIT));
    expect(requestUrl(1).searchParams.get("maxResults")).toBe("1");
  });

  it("passes a validated page token through", async () => {
    fetchMock.mockResolvedValue(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({ query: SEARCH_QUERY, pageToken: "CAoQAA" });

    expect(requestUrl().searchParams.get("pageToken")).toBe("CAoQAA");
  });

  it("maps filters to videoDuration, order and publishedAfter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    fetchMock.mockResolvedValue(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({
      query: SEARCH_QUERY,
      duration: "short",
      order: "viewCount",
      uploadDate: "week",
    });

    const url = requestUrl();
    expect(url.searchParams.get("videoDuration")).toBe("short");
    expect(url.searchParams.get("order")).toBe("viewCount");
    expect(url.searchParams.get("publishedAfter")).toBe("2025-12-25T12:00:00.000Z");
  });

  it("omits every filter parameter when the values are the defaults", async () => {
    fetchMock.mockResolvedValue(jsonResponse(searchPayload([])));

    await searchVideos({
      query: SEARCH_QUERY,
      duration: "any",
      order: "relevance",
      uploadDate: "any",
    });

    expect(Object.fromEntries(requestUrl().searchParams)).toEqual({
      part: "snippet",
      type: "video",
      q: SEARCH_QUERY,
      maxResults: "25",
      key: FAKE_KEY,
    });
  });

  it("rejects invalid filter values before the network", async () => {
    const invalid = [
      { duration: "tiny" },
      { order: "popular" },
      { uploadDate: "year" },
    ] as unknown as Array<
      Partial<Pick<Parameters<typeof searchVideos>[0], "duration" | "order" | "uploadDate">>
    >;

    for (const filters of invalid) {
      await expect(searchVideos({ query: SEARCH_QUERY, ...filters })).rejects.toBeInstanceOf(
        DomainValidationError,
      );
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getVideo", () => {
  it("requests snippet, contentDetails and statistics and maps the detail", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const detail = await getVideo(VIDEO_ID);

    const url = requestUrl();
    expect(url.pathname).toBe("/youtube/v3/videos");
    expect(url.searchParams.get("part")).toBe("snippet,contentDetails,statistics");
    expect(url.searchParams.get("id")).toBe(VIDEO_ID);

    expect(detail).toMatchObject({
      id: VIDEO_ID,
      title: "Never Gonna Give You Up",
      durationSeconds: 213,
      viewCount: 1500000000,
    });
    expect(detail).not.toBeNull();
    expect(typeof detail?.description).toBe("string");
  });

  it("returns null for an empty items array", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([])));

    await expect(getVideo(VIDEO_ID)).resolves.toBeNull();
  });

  // CONTRACT (T13): the detail endpoint is the only one that carries the
  // description; list endpoints must not.
  it("keeps description as an own property of the detail", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const detail = await getVideo(VIDEO_ID);

    expect(detail).not.toBeNull();
    expect(Object.hasOwn(detail as object, "description")).toBe(true);
    expect(detail?.description).toBe(DESCRIPTION_TEXT);
  });
});

describe("getChannel", () => {
  it("requests snippet, statistics and contentDetails for one channel id", async () => {
    fetchMock.mockResolvedValue(jsonResponse(channelPayload([channelItem(CHANNEL_ID)])));

    const channel = await getChannel(CHANNEL_ID);

    const url = requestUrl();
    expect(url.pathname).toBe("/youtube/v3/channels");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: "snippet,statistics,contentDetails",
      id: CHANNEL_ID,
      key: FAKE_KEY,
    });
    expect(channel).toEqual({
      id: CHANNEL_ID,
      title: "Rick Astley",
      avatarUrl: "https://yt3.ggpht.com/channel-high=s800",
      subscriberCount: 4_200_000,
      description: "The official Rick Astley channel.",
      uploadsPlaylistId: UPLOADS_PLAYLIST_ID,
    });
    expect(JSON.stringify(channel)).not.toContain(FAKE_KEY);
  });

  it("returns null for an empty items array", async () => {
    fetchMock.mockResolvedValue(jsonResponse(channelPayload([])));

    await expect(getChannel(CHANNEL_ID)).resolves.toBeNull();
  });

  it("rejects an invalid channel id before the network", async () => {
    for (const id of ["", "short", `UU${CHANNEL_ID.slice(2)}`, ` ${CHANNEL_ID}`]) {
      await expect(getChannel(id)).rejects.toBeInstanceOf(DomainValidationError);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes one request per uncached channel", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      return jsonResponse(channelPayload([channelItem(url.searchParams.get("id") ?? "")]));
    });

    await getChannel(CHANNEL_ID);
    await getChannel(OTHER_CHANNEL_ID);
    await getChannel(CHANNEL_ID);
    await getChannel(OTHER_CHANNEL_ID);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(0).searchParams.get("id")).toBe(CHANNEL_ID);
    expect(requestUrl(1).searchParams.get("id")).toBe(OTHER_CHANNEL_ID);
  });

  it("caches the normalized channel for 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    fetchMock.mockImplementation(async () =>
      jsonResponse(channelPayload([channelItem(CHANNEL_ID)])),
    );

    expect(YOUTUBE_CACHE_TTLS_MS.channels).toBe(24 * 60 * 60_000);

    await getChannel(CHANNEL_ID);
    await getChannel(CHANNEL_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + YOUTUBE_CACHE_TTLS_MS.channels - 1);
    await getChannel(CHANNEL_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await getChannel(CHANNEL_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a malformed payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: "nope" }));

    await expect(getChannel(CHANNEL_ID)).rejects.toBeInstanceOf(DomainValidationError);

    fetchMock.mockResolvedValueOnce(jsonResponse(channelPayload([channelItem(CHANNEL_ID)])));

    await expect(getChannel(CHANNEL_ID)).resolves.toMatchObject({ id: CHANNEL_ID });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("listPlaylistItems", () => {
  it("requests one uploads page with snippet, contentDetails and the default 25 results", async () => {
    fetchMock.mockResolvedValue(jsonResponse(playlistPayload([playlistItem(VIDEO_ID)])));

    const videos = await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID });

    const url = requestUrl();
    expect(url.pathname).toBe("/youtube/v3/playlistItems");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: "snippet,contentDetails",
      playlistId: UPLOADS_PLAYLIST_ID,
      maxResults: "25",
      key: FAKE_KEY,
    });
    expect(videos).toEqual([
      {
        id: VIDEO_ID,
        title: "A recent upload",
        channelId: CHANNEL_ID,
        channelTitle: "Rick Astley",
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        publishedAt: "2026-01-02T03:04:05Z",
        durationSeconds: null,
        viewCount: null,
      },
    ]);
    expect(JSON.stringify(videos)).not.toContain(FAKE_KEY);
  });

  it("clamps maxResults to 1..50", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(playlistPayload([])));

    await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID, maxResults: 0 });
    await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID, maxResults: 500 });

    expect(requestUrl(0).searchParams.get("maxResults")).toBe("1");
    expect(requestUrl(1).searchParams.get("maxResults")).toBe("50");
  });

  it("rejects an invalid playlist id before the network", async () => {
    for (const playlistId of ["", "short", "has spaces", "PL!not-safe"]) {
      await expect(listPlaylistItems({ playlistId })).rejects.toBeInstanceOf(DomainValidationError);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty array for an empty uploads page", async () => {
    fetchMock.mockResolvedValue(jsonResponse(playlistPayload([])));

    await expect(listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID })).resolves.toEqual([]);
  });

  it("caches the normalized uploads for ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    fetchMock.mockImplementation(async () =>
      jsonResponse(playlistPayload([playlistItem(VIDEO_ID)])),
    );

    expect(YOUTUBE_CACHE_TTLS_MS.playlistItems).toBe(10 * 60_000);

    await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID });
    await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + YOUTUBE_CACHE_TTLS_MS.playlistItems - 1);
    await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a malformed uploads payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: "nope" }));

    await expect(listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID })).rejects.toBeInstanceOf(
      DomainValidationError,
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(playlistPayload([playlistItem(VIDEO_ID)])));

    await expect(listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID })).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a quota failure without caching it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiErrorPayload(403, "quotaExceeded"), 403));

    const error = expectApiError(
      await readThrown(() => listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID })),
      "quota",
    );
    expect(error.reason).toBe("quotaExceeded");

    fetchMock.mockResolvedValue(jsonResponse(playlistPayload([playlistItem(VIDEO_ID)])));

    await expect(listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID })).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getVideos", () => {
  it("validates every id before calling the API", async () => {
    const error = await readThrown(() => getVideos([VIDEO_ID, "too-short"]));

    expect(error).toBeInstanceOf(DomainValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid single id without calling the API", async () => {
    const error = await readThrown(() => getVideo("not-valid"));

    expect(error).toBeInstanceOf(DomainValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches more than 50 ids into multiple requests", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const ids = (url.searchParams.get("id") ?? "").split(",").filter((id) => id.length > 0);
      return jsonResponse(videoPayload(ids.map((id) => videoItem(id))));
    });

    const ids = Array.from({ length: 51 }, (_unused, index) => String(index).padStart(11, "0"));

    const videos = await getVideos(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(0).searchParams.get("id")?.split(",")).toHaveLength(50);
    expect(requestUrl(1).searchParams.get("id")?.split(",")).toHaveLength(1);
    expect(videos).toHaveLength(51);
    expect(videos[0]?.id).toBe(ids[0]);
    expect(videos[50]?.id).toBe(ids[50]);
  });

  it("returns an empty array for no ids without a request", async () => {
    await expect(getVideos([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // CONTRACT (T13): a summary has no `description` own property at runtime, even
  // though the item is normalized through the detail normalizer.
  it("returns summaries without a description own-property", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const videos = await getVideos([VIDEO_ID]);

    expect(videos).toHaveLength(1);
    const [summary] = videos;
    expect(summary).not.toBeUndefined();
    expect(Object.hasOwn(summary as object, "description")).toBe(false);
    expect(Object.keys(summary as object)).not.toContain("description");
    expect(JSON.stringify(videos)).not.toContain(DESCRIPTION_TEXT);
    // The summary fields themselves still arrive intact.
    expect(summary).toMatchObject({ id: VIDEO_ID, durationSeconds: 213, viewCount: 1500000000 });
  });
});

describe("getTrending", () => {
  it("requests the most popular chart for the region", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const videos = await getTrending({ regionCode: "gb", maxResults: 10 });

    const url = requestUrl();
    expect(url.pathname).toBe("/youtube/v3/videos");
    expect(url.searchParams.get("chart")).toBe("mostPopular");
    expect(url.searchParams.get("regionCode")).toBe("GB");
    expect(url.searchParams.get("maxResults")).toBe("10");
    expect(videos).toHaveLength(1);
  });

  // CONTRACT (T13): trending is a list endpoint, so its items are summaries.
  it("returns trending summaries without a description own-property", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const videos = await getTrending();

    expect(videos).toHaveLength(1);
    const [summary] = videos;
    expect(summary).not.toBeUndefined();
    expect(Object.hasOwn(summary as object, "description")).toBe(false);
    expect(JSON.stringify(videos)).not.toContain(DESCRIPTION_TEXT);
    expect(summary).toMatchObject({ id: VIDEO_ID, durationSeconds: 213 });
  });
});

describe("listComments", () => {
  it("requests relevance-ordered top-level threads with the default page size", async () => {
    fetchMock.mockResolvedValue(jsonResponse(commentPayload([commentThread("c1")])));

    const page = await listComments({ videoId: VIDEO_ID });

    const url = requestUrl();
    expect(url.pathname).toBe("/youtube/v3/commentThreads");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: "snippet",
      videoId: VIDEO_ID,
      order: "relevance",
      maxResults: "20",
      key: FAKE_KEY,
    });

    expect(page.commentsDisabled).toBe(false);
    expect(page.items).toEqual([
      {
        id: "c1",
        author: "Ada Lovelace",
        text: "Great video!",
        likeCount: 12,
        publishedAt: "2026-01-02T03:04:05Z",
        replyCount: 2,
      },
    ]);
  });

  it("passes a validated page token and a clamped maxResults", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(commentPayload([])));

    await listComments({ videoId: VIDEO_ID, pageToken: "CAoQAA", maxResults: 500 });
    expect(requestUrl(0).searchParams.get("pageToken")).toBe("CAoQAA");
    expect(requestUrl(0).searchParams.get("maxResults")).toBe(String(MAX_COMMENT_RESULTS_LIMIT));

    await listComments({ videoId: VIDEO_ID, maxResults: 0 });
    expect(requestUrl(1).searchParams.get("maxResults")).toBe("1");
  });

  it("rejects an invalid video id or page token before the network", async () => {
    await expect(listComments({ videoId: "short" })).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      listComments({ videoId: VIDEO_ID, pageToken: "not a token" }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // CONTRACT (T80): disabled comments are a normal page, not a thrown error.
  it("maps a 403 commentsDisabled response to a disabled page", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiErrorPayload(403, "commentsDisabled"), 403));

    const page = await listComments({ videoId: VIDEO_ID });

    expect(page).toEqual({ items: [], nextPageToken: null, commentsDisabled: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still surfaces quota and malformed payload failures", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiErrorPayload(403, "quotaExceeded"), 403));

    const quota = expectApiError(
      await readThrown(() => listComments({ videoId: VIDEO_ID })),
      "quota",
    );
    expect(quota.reason).toBe("quotaExceeded");

    fetchMock.mockResolvedValue(jsonResponse({ items: "nope" }));

    const malformed = await readThrown(() => listComments({ videoId: VIDEO_ID }));
    expect(malformed).toBeInstanceOf(DomainValidationError);
  });

  it("caches the normalized page for five minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(async () => jsonResponse(commentPayload([commentThread("c1")])));

    await listComments({ videoId: VIDEO_ID });
    await listComments({ videoId: VIDEO_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + YOUTUBE_CACHE_TTLS_MS.comments - 1);
    await listComments({ videoId: VIDEO_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await listComments({ videoId: VIDEO_ID });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches the disabled page so a disabled video does not spend quota per view", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(403, "commentsDisabled"), 403),
    );

    await listComments({ videoId: VIDEO_ID });
    await listComments({ videoId: VIDEO_ID });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("error mapping", () => {
  it("maps 403 quotaExceeded to quota without leaking the key", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(403, "quotaExceeded"), 403),
    );

    const error = expectApiError(
      await readThrown(() => searchVideos({ query: SEARCH_QUERY })),
      "quota",
    );

    expect(error.status).toBe(403);
    expect(error.reason).toBe("quotaExceeded");
    expect(error.message).toContain("quota");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("googleapis.com");
    expect(error.stack ?? "").not.toContain(FAKE_KEY);
    expect(JSON.stringify(error)).not.toContain(FAKE_KEY);
    expect(String(error)).not.toContain(FAKE_KEY);
  });

  it("maps 400 keyInvalid to auth", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(apiErrorPayload(400, "keyInvalid"), 400));

    const error = expectApiError(await readThrown(() => getVideo(VIDEO_ID)), "auth");

    expect(error.status).toBe(400);
    expect(error.reason).toBe("keyInvalid");
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("maps 5xx to upstream after a single retry", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(503, "backendError"), 503),
    );

    const error = expectApiError(
      await readThrown(() => searchVideos({ query: SEARCH_QUERY })),
      "upstream",
    );

    expect(error.status).toBe(503);
    expect(error.reason).toBe("backendError");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps an aborted request to timeout without retrying", async () => {
    const timeout = new Error("The operation was aborted.");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);

    const error = expectApiError(
      await readThrown(() => searchVideos({ query: SEARCH_QUERY })),
      "timeout",
    );

    expect(error.status).toBeNull();
    expect(error.reason).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("maps a rejected fetch to network without retrying", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const error = expectApiError(
      await readThrown(() => searchVideos({ query: SEARCH_QUERY })),
      "network",
    );

    expect(error.status).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 404 to not_found and other 4xx to bad_request", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(404, "videoNotFound"), 404),
    );
    const notFound = expectApiError(await readThrown(() => getVideo(VIDEO_ID)), "not_found");
    expect(notFound.status).toBe(404);

    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(400, "invalidParameter"), 400),
    );
    const badRequest = expectApiError(
      await readThrown(() => searchVideos({ query: SEARCH_QUERY })),
      "bad_request",
    );
    expect(badRequest.reason).toBe("invalidParameter");
  });
});

describe("caching", () => {
  it("serves a repeated search from cache with one upstream request", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    const first = await searchVideos({ query: "Cached  Query" });
    const second = await searchVideos({ query: "cached query" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).not.toContain(FAKE_KEY);
  });

  it("does not share entries between different parameters", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({ query: "same terms", maxResults: 10 });
    await searchVideos({ query: "same terms", maxResults: 11 });
    await searchVideos({ query: "different terms", maxResults: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caches each filter combination separately and reuses a repeated one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    // The same filtered search twice: one upstream request.
    await searchVideos({ query: "filtered", duration: "short" });
    await searchVideos({ query: "filtered", duration: "short" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Every other combination is its own entry.
    await searchVideos({ query: "filtered", duration: "medium" });
    await searchVideos({ query: "filtered", order: "date" });
    await searchVideos({ query: "filtered", order: "viewCount" });
    await searchVideos({ query: "filtered", uploadDate: "day" });
    await searchVideos({ query: "filtered", uploadDate: "week" });

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("shares a filtered entry across millisecond differences inside one minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({ query: "minute bucket", uploadDate: "day" });
    vi.setSystemTime(new Date("2026-01-01T12:00:59.000Z"));
    await searchVideos({ query: "minute bucket", uploadDate: "day" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes a search after its 60 second TTL using fake timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({ query: "ttl search" });
    await searchVideos({ query: "ttl search" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + YOUTUBE_CACHE_TTLS_MS.search - 1);
    await searchVideos({ query: "ttl search" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await searchVideos({ query: "ttl search" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps video details for ten minutes and then refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    fetchMock.mockImplementation(async () => jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    await getVideo(VIDEO_ID);
    await getVideo(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + YOUTUBE_CACHE_TTLS_MS.videoDetails - 1);
    await getVideo(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await getVideo(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps trending for five minutes and then refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    fetchMock.mockImplementation(async () => jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    await getTrending();
    await getTrending();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + YOUTUBE_CACHE_TTLS_MS.trending - 1);
    await getTrending();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await getTrending();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent identical requests into one upstream fetch", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = searchVideos({ query: "coalesced query" });
    const second = searchVideos({ query: "coalesced query" });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    const [firstPage, secondPage] = await Promise.all([first, second]);
    expect(secondPage).toEqual(firstPage);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a cache hit without reading the API key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    const first = await searchVideos({ query: "keyless hit" });
    setKey(undefined);

    const second = await searchVideos({ query: "keyless hit" });

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache errors, so the next call retries upstream", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(apiErrorPayload(400, "invalidParameter"), 400))
      .mockResolvedValueOnce(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await expect(searchVideos({ query: "error then success" })).rejects.toBeInstanceOf(
      YouTubeApiError,
    );
    const page = await searchVideos({ query: "error then success" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.items).toHaveLength(1);
  });

  it("honours the YOUTUBE_CACHE_DISABLED bypass", async () => {
    process.env.YOUTUBE_CACHE_DISABLED = "1";
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({ query: "bypass query" });
    await searchVideos({ query: "bypass query" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/** 11-character ids, so batching tests can generate as many as they need. */
function makeVideoId(index: number): string {
  return `vid${String(index).padStart(8, "0")}`;
}

/**
 * Runs a call that is expected to retry once, on fake timers so the 200 ms
 * backoff costs no wall-clock time. The outcome (value or error) is replayed to
 * the caller.
 */
async function withRetryClock<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const settled = run().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  // Let the first attempt settle, then fire the single retry timer.
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(200);

  const outcome = await settled;

  if (!outcome.ok) {
    throw outcome.error;
  }

  return outcome.value;
}

describe("request construction", () => {
  it("sends exactly the search parameters, omitting an absent page token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(searchPayload([])));

    await searchVideos({ query: "  spaced   query  " });

    expect(Object.fromEntries(requestUrl().searchParams)).toEqual({
      part: "snippet",
      type: "video",
      q: "spaced   query",
      maxResults: "25",
      key: FAKE_KEY,
    });
  });

  it("round-trips a query with special characters and includes the page token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(searchPayload([])));

    await searchVideos({ query: "rock & roll = 100%", maxResults: 7, pageToken: "CAoQAA" });

    const url = requestUrl();
    expect(url.searchParams.get("q")).toBe("rock & roll = 100%");
    expect(url.searchParams.get("maxResults")).toBe("7");
    expect(url.searchParams.get("pageToken")).toBe("CAoQAA");
  });

  it("sends exactly the video detail parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    await getVideo(VIDEO_ID);

    expect(Object.fromEntries(requestUrl().searchParams)).toEqual({
      part: "snippet,contentDetails,statistics",
      id: VIDEO_ID,
      key: FAKE_KEY,
    });
  });

  it("sends trending parameters with the default region", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    await getTrending();

    expect(Object.fromEntries(requestUrl().searchParams)).toEqual({
      part: "snippet,contentDetails,statistics",
      chart: "mostPopular",
      regionCode: "US",
      maxResults: "25",
      key: FAKE_KEY,
    });
  });

  it("rejects invalid region codes before the network", async () => {
    for (const regionCode of ["", "g", "gbr", "12", " gb", "ÜS"]) {
      await expect(getTrending({ regionCode })).rejects.toBeInstanceOf(DomainValidationError);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("maxResults clamping", () => {
  it("clamps to 1..50 and falls back to 25 for non-finite values", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    const cases: Array<[number | undefined, string]> = [
      [undefined, "25"],
      [1, "1"],
      [50, "50"],
      [51, "50"],
      [500, "50"],
      [0, "1"],
      [-3, "1"],
      [2.9, "2"],
      [Number.NaN, "25"],
      [Number.POSITIVE_INFINITY, "25"],
    ];

    for (const [index, [value, expected]] of cases.entries()) {
      // Distinct queries keep the cache from hiding a second request.
      await searchVideos({ query: `clamp ${index}`, maxResults: value });

      expect(requestUrl(index).searchParams.get("maxResults")).toBe(expected);
    }
  });

  it("applies the same clamp to trending", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    await getTrending({ maxResults: 0 });
    await getTrending({ maxResults: 999 });

    expect(requestUrl(0).searchParams.get("maxResults")).toBe("1");
    expect(requestUrl(1).searchParams.get("maxResults")).toBe(String(MAX_RESULTS_LIMIT));
  });
});

describe("getVideos batching boundaries", () => {
  it("sends one request for exactly 50 ids", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return jsonResponse(videoPayload(ids.map((id) => videoItem(id))));
    });

    const ids = Array.from({ length: 50 }, (_unused, index) => makeVideoId(index));
    const videos = await getVideos(ids);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl(0).searchParams.get("id")?.split(",")).toHaveLength(50);
    expect(videos).toHaveLength(50);
  });

  it("sends two requests for 100 ids without dropping any", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return jsonResponse(videoPayload(ids.map((id) => videoItem(id))));
    });

    const ids = Array.from({ length: 100 }, (_unused, index) => makeVideoId(index));
    const videos = await getVideos(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(0).searchParams.get("id")?.split(",")).toHaveLength(50);
    expect(requestUrl(1).searchParams.get("id")?.split(",")).toHaveLength(50);
    expect(videos.map((video) => video.id)).toEqual(ids);
  });

  it("requests duplicate ids once and keeps first-seen order", async () => {
    const first = makeVideoId(1);
    const second = makeVideoId(2);
    fetchMock.mockResolvedValue(
      // The API is free to return items in any order.
      jsonResponse(videoPayload([videoItem(second), videoItem(first)])),
    );

    const videos = await getVideos([first, second, first]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl().searchParams.get("id")).toBe(`${first},${second}`);
    expect(videos.map((video) => video.id)).toEqual([first, second]);
  });

  it("omits ids the API does not return", async () => {
    const returned = makeVideoId(1);
    const missing = makeVideoId(2);
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(returned)])));

    const videos = await getVideos([returned, missing]);

    expect(videos.map((video) => video.id)).toEqual([returned]);
  });
});

describe("retry policy", () => {
  it("retries a 500 once and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(apiErrorPayload(503, "backendError"), 503))
      .mockResolvedValueOnce(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    const page = await withRetryClock(() => searchVideos({ query: "retry 500" }));

    expect(page.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 once and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(apiErrorPayload(429, "rateLimitExceeded"), 429))
      .mockResolvedValueOnce(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const detail = await withRetryClock(() => getVideo(VIDEO_ID));

    expect(detail?.id).toBe(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry of a 429 and maps it to bad_request", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(429, "rateLimitExceeded"), 429),
    );

    const error = expectApiError(
      await withRetryClock(() => readThrown(() => searchVideos({ query: "retry twice 429" }))),
      "bad_request",
    );

    expect(error.status).toBe(429);
    expect(error.reason).toBe("rateLimitExceeded");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(400, "invalidParameter"), 400),
    );

    expectApiError(await readThrown(() => searchVideos({ query: "no retry 400" })), "bad_request");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 404", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(404, "videoNotFound"), 404),
    );

    expectApiError(await readThrown(() => getVideo(VIDEO_ID)), "not_found");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 403 keyInvalid to auth and other 403 reasons to bad_request", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(apiErrorPayload(403, "keyInvalid"), 403));

    const auth = expectApiError(
      await readThrown(() => searchVideos({ query: "forbidden key" })),
      "auth",
    );
    expect(auth.status).toBe(403);
    expect(auth.reason).toBe("keyInvalid");

    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(403, "accessNotConfigured"), 403),
    );

    const badRequest = expectApiError(
      await readThrown(() => searchVideos({ query: "forbidden config" })),
      "bad_request",
    );
    expect(badRequest.reason).toBe("accessNotConfigured");
  });

  it("maps 401 to bad_request", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(apiErrorPayload(401, "unauthorized"), 401),
    );

    const error = expectApiError(await readThrown(() => getVideo(VIDEO_ID)), "bad_request");

    expect(error.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a malformed 200 body as upstream", async () => {
    fetchMock.mockResolvedValue(
      new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const error = expectApiError(await readThrown(() => getVideo(VIDEO_ID)), "upstream");

    expect(error.status).toBe(200);
    expect(error.reason).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a reason that is not a safe enumerated identifier", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        { error: { code: 503, errors: [{ reason: `legacy reason ${FAKE_KEY}` }] } },
        503,
      ),
    );

    const error = expectApiError(
      await withRetryClock(() => readThrown(() => searchVideos({ query: "unsafe reason" }))),
      "upstream",
    );

    expect(error.reason).toBeNull();
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("picks the first safe reason from the error envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 403,
            errors: [
              { reason: "not a safe reason" },
              { reason: "quotaExceeded" },
              { reason: "anotherReason" },
            ],
          },
        },
        403,
      ),
    );

    const error = expectApiError(
      await readThrown(() => searchVideos({ query: "first safe reason" })),
      "quota",
    );

    expect(error.reason).toBe("quotaExceeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("malformed upstream payloads", () => {
  it("surfaces a malformed search payload as a DomainValidationError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));

    const error = await readThrown(() => searchVideos({ query: "malformed search" }));

    expect(error).toBeInstanceOf(DomainValidationError);
    if (error instanceof DomainValidationError) {
      expect(error.code).toBe("malformed_payload");
    }
  });

  it("surfaces a malformed video payload as a DomainValidationError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: "not-an-array" }));

    const error = await readThrown(() => getVideo(VIDEO_ID));

    expect(error).toBeInstanceOf(DomainValidationError);
    if (error instanceof DomainValidationError) {
      expect(error.code).toBe("malformed_payload");
    }
  });

  it("surfaces a malformed trending payload as a DomainValidationError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: null }));

    const error = await readThrown(() => getTrending());

    expect(error).toBeInstanceOf(DomainValidationError);
    if (error instanceof DomainValidationError) {
      expect(error.code).toBe("malformed_payload");
    }
  });

  // REGRESSION (T38): guards the "errors are never cached" guarantee. A 200
  // response whose body fails normalization must not be stored in the request
  // cache, or the DomainValidationError would be replayed for the full TTL
  // instead of being retried upstream. This test must fail if the cache ever
  // stores an unnormalized payload again.
  it("re-fetches after a payload that fails normalization instead of serving it from cache", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ nope: true }))
      .mockResolvedValueOnce(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await expect(searchVideos({ query: "malformed then good" })).rejects.toBeInstanceOf(
      DomainValidationError,
    );

    const page = await searchVideos({ query: "malformed then good" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.items).toHaveLength(1);
  });
});

describe("key containment", () => {
  it("never exposes the key in results from any endpoint", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/search")) {
        return jsonResponse(searchPayload([searchItem(VIDEO_ID)]));
      }

      if (url.pathname.endsWith("/commentThreads")) {
        return jsonResponse(commentPayload([commentThread("c1")]));
      }

      return jsonResponse(videoPayload([videoItem(VIDEO_ID)]));
    });

    const results = [
      await searchVideos({ query: "key containment" }),
      await getVideo(VIDEO_ID),
      await getVideos([VIDEO_ID]),
      await getTrending(),
      await listComments({ videoId: VIDEO_ID }),
      await listPlaylistItems({ playlistId: UPLOADS_PLAYLIST_ID }),
    ];
    const serialized = JSON.stringify(results);

    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain("AIza");
    expect(serialized).not.toContain("key=");
  });

  it("discards a transport error message that contains the request URL", async () => {
    fetchMock.mockRejectedValue(
      new TypeError(
        `fetch failed for https://www.googleapis.com/youtube/v3/search?key=${FAKE_KEY}`,
      ),
    );

    const error = expectApiError(await readThrown(() => getTrending()), "network");

    expect(error.message).not.toContain(FAKE_KEY);
    expect(String(error)).not.toContain(FAKE_KEY);
    expect(error.stack ?? "").not.toContain(FAKE_KEY);
    expect(error.cause).toBeUndefined();
  });

  it("does not forward an upstream body that echoes the key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 400,
            message: `Bad request: https://www.googleapis.com/youtube/v3/search?key=${FAKE_KEY}`,
            errors: [{ message: `key=${FAKE_KEY}`, reason: "invalidParameter" }],
          },
        },
        400,
      ),
    );

    const error = expectApiError(
      await readThrown(() => searchVideos({ query: "echoing upstream" })),
      "bad_request",
    );

    expect(error.reason).toBe("invalidParameter");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(String(error)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(error)).not.toContain(FAKE_KEY);
    expect(error.stack ?? "").not.toContain(FAKE_KEY);
  });
});

describe("cache bypass variants", () => {
  it("bypasses reads and writes for the value 'true'", async () => {
    process.env.YOUTUBE_CACHE_DISABLED = "true";
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([searchItem(VIDEO_ID)])));

    await searchVideos({ query: "bypass true" });
    await searchVideos({ query: "bypass true" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bypasses coalescing too, issuing one request per caller", async () => {
    process.env.YOUTUBE_CACHE_DISABLED = "on";
    const resolvers: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const first = searchVideos({ query: "bypass coalescing" });
    const second = searchVideos({ query: "bypass coalescing" });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (const resolve of resolvers) {
      resolve(jsonResponse(searchPayload([searchItem(VIDEO_ID)])));
    }

    const [firstPage, secondPage] = await Promise.all([first, second]);
    expect(firstPage).toEqual(secondPage);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves a cached video detail without reading the API key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const first = await getVideo(VIDEO_ID);
    setKey(undefined);

    const second = await getVideo(VIDEO_ID);

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/trending serialised body", () => {
  // CONTRACT (T13): `/api/trending` forwards `getTrending` items as-is, so the
  // guarantee has to be proven through the real client. `route.test.ts` mocks
  // `getTrending`, which is why this end-to-end assertion lives here.
  it("contains no description field or description text", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const response = await getTrendingRoute(new Request("http://localhost/api/trending"));
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(raw).not.toContain(DESCRIPTION_TEXT);
    expect(raw).not.toContain("description");

    const body = JSON.parse(raw) as {
      items: Array<Record<string, unknown>>;
      regionCode: string;
    };
    expect(body.items).toHaveLength(1);
    expect(Object.hasOwn(body.items[0] ?? {}, "description")).toBe(false);
    expect(body.regionCode).toMatch(/^[A-Z]{2}$/);
  });
});
