import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` deliberately throws when imported outside a Server Component
// graph; Vitest is not one, so the marker module is mocked here.
vi.mock("server-only", () => ({}));

import {
  MAX_RESULTS_LIMIT,
  YouTubeApiError,
  getTrending,
  getVideo,
  getVideos,
  isYouTubeApiError,
  listVideoCategories,
  searchVideos,
} from "@/lib/youtube/client";
import { DomainValidationError } from "@/shared/validation";

/** Credential-shaped fake used only to prove the key stays in the request URL. */
const FAKE_KEY = "AIzaSyFAKE-client-test-key-000000";
const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

const VIDEO_ID = "dQw4w9WgXcQ";
const SEARCH_QUERY = "never gonna give you up";

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
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setKey(ORIGINAL_KEY);
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
});

describe("getTrending and listVideoCategories", () => {
  it("requests the most popular chart for the region", async () => {
    fetchMock.mockResolvedValue(jsonResponse(videoPayload([videoItem(VIDEO_ID)])));

    const videos = await getTrending({ regionCode: "gb", maxResults: 10 });

    const url = requestUrl();
    expect(url.pathname).toBe("/youtube/v3/videos");
    expect(url.searchParams.get("chart")).toBe("mostPopular");
    expect(url.searchParams.get("regionCode")).toBe("GB");
    expect(url.searchParams.get("maxResults")).toBe("10");
    expect(videos).toHaveLength(1);
  });

  it("maps categories and drops unusable entries", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          { id: "10", snippet: { title: " Music ", assignable: true } },
          { id: "20", snippet: { title: "", assignable: false } },
          { id: "", snippet: { title: "Broken", assignable: true } },
        ],
      }),
    );

    const categories = await listVideoCategories("us");

    expect(requestUrl().pathname).toBe("/youtube/v3/videoCategories");
    expect(requestUrl().searchParams.get("regionCode")).toBe("US");
    expect(categories).toEqual([{ id: "10", title: "Music", assignable: true }]);
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
