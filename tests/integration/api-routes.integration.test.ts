// @vitest-environment node
/**
 * Integration tests for the JSON route handlers (T39).
 *
 * These exercise the route -> YouTube client boundary with a real `Request` and
 * a stubbed client: only the three network-facing functions are replaced, so the
 * real `YouTubeApiError` class, the shared error envelope and the status mapping
 * run exactly as in production. The existing `*.route.test.ts` suites own the
 * exhaustive error-code matrix; this file covers the contract the browser and
 * the client actually depend on, plus the specific failure modes named in T39.
 *
 * `server-only` is stubbed because Vitest is not a Server Component graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return {
    ...actual,
    getTrending: vi.fn(),
    getVideo: vi.fn(),
    searchVideos: vi.fn(),
  };
});

import { GET as searchRoute } from "@/app/api/search/route";
import { GET as trendingRoute } from "@/app/api/trending/route";
import { GET as videoRoute } from "@/app/api/videos/[id]/route";
import type { ApiErrorBody } from "@/lib/errors";
import {
  YouTubeApiError,
  getTrending as getTrendingClient,
  getVideo as getVideoClient,
  searchVideos as searchVideosClient,
} from "@/lib/youtube/client";
import type { SearchPage, VideoDetail, VideoSummary } from "@/shared/types";

const VIDEO_ID = "dQw4w9WgXcQ";

/** Credential-shaped fake: only used to prove it never reaches a response body. */
const FAKE_KEY = "AIzaSyFAKE-integration-key-000000";

const SUMMARY: VideoSummary = {
  id: VIDEO_ID,
  title: "Never Gonna Give You Up",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_500_000_000,
};

const DETAIL: VideoDetail = {
  ...SUMMARY,
  description: "The official music video.",
};

const PAGE: SearchPage = {
  items: [SUMMARY],
  nextPageToken: "CAoQAA",
  totalResults: 1_234,
};

const searchVideosMock = vi.mocked(searchVideosClient);
const getVideoMock = vi.mocked(getVideoClient);
const getTrendingMock = vi.mocked(getTrendingClient);

/** Builds the request Next hands to a route handler. */
function request(path: string): Request {
  return new Request(`https://viewly.test${path}`);
}

/** Calls the video route the way Next does: a Request plus a params Promise. */
function videoRequest(id: string): Promise<Response> {
  return videoRoute(request(`/api/videos/${encodeURIComponent(id)}`), {
    params: Promise.resolve({ id }),
  });
}

/** Reads the shared error envelope. */
async function errorBody(response: Response): Promise<ApiErrorBody> {
  return (await response.json()) as ApiErrorBody;
}

beforeEach(() => {
  searchVideosMock.mockReset();
  getVideoMock.mockReset();
  getTrendingMock.mockReset();

  // Any real network call is a test bug: the client is the only outbound seam.
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.reject(new Error("Network access is not allowed in this test.")),
  );
  // Failures are logged by design; keep the test output quiet.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/search (integration)", () => {
  it("returns the normalized page and forwards the trimmed query and page token", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    const response = await searchRoute(
      request(`/api/search?q=${encodeURIComponent("  rick astley  ")}&pageToken=CAoQAA`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");

    const body = (await response.json()) as SearchPage;

    expect(body).toEqual({ items: [SUMMARY], nextPageToken: "CAoQAA", totalResults: 1_234 });
    expect(Object.keys(body).sort()).toEqual(["items", "nextPageToken", "totalResults"]);
    expect(searchVideosMock).toHaveBeenCalledTimes(1);
    expect(searchVideosMock).toHaveBeenCalledWith({ query: "rick astley", pageToken: "CAoQAA" });
  });

  it("maps an exhausted quota to 429 without echoing upstream detail", async () => {
    searchVideosMock.mockRejectedValue(
      new YouTubeApiError(
        "quota",
        `quota exceeded: https://www.googleapis.com/youtube/v3/search?key=${FAKE_KEY}`,
        { status: 403, reason: "quotaExceeded" },
      ),
    );

    const response = await searchRoute(request("/api/search?q=rick"));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await errorBody(response);

    expect(body.error.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(body)).not.toContain("googleapis.com");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/videos/[id] (integration)", () => {
  it("returns the detail for a valid id and forwards the id to the client", async () => {
    getVideoMock.mockResolvedValue(DETAIL);

    const response = await videoRequest(VIDEO_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    await expect(response.json()).resolves.toEqual(DETAIL);
    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
  });

  it("returns 404 NOT_FOUND when the client resolves null", async () => {
    getVideoMock.mockResolvedValue(null);

    const response = await videoRequest(VIDEO_ID);

    expect(response.status).toBe(404);
    expect((await errorBody(response)).error.code).toBe("NOT_FOUND");
  });

  it("returns 400 VALIDATION_FAILED for a malformed id before calling the client", async () => {
    const response = await videoRequest("too-short");

    expect(response.status).toBe(400);
    const body = await errorBody(response);

    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("videoId");
    expect(getVideoMock).not.toHaveBeenCalled();
  });

  it("returns 429 RATE_LIMITED when the quota is exhausted", async () => {
    getVideoMock.mockRejectedValue(
      new YouTubeApiError("quota", `quotaExceeded for key ${FAKE_KEY}`, { status: 403 }),
    );

    const response = await videoRequest(VIDEO_ID);

    expect(response.status).toBe(429);
    expect((await errorBody(response)).error.code).toBe("RATE_LIMITED");
  });

  it("returns 502 UPSTREAM_ERROR when the upstream fails", async () => {
    getVideoMock.mockRejectedValue(
      new YouTubeApiError("upstream", `backend error for key ${FAKE_KEY}`, { status: 503 }),
    );

    const response = await videoRequest(VIDEO_ID);

    expect(response.status).toBe(502);
    const body = await errorBody(response);

    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
  });
});

describe("GET /api/trending (integration)", () => {
  it("returns items with the resolved region and forwards normalized options", async () => {
    getTrendingMock.mockResolvedValue([SUMMARY]);

    const response = await trendingRoute(request("/api/trending?region=gb&maxResults=10"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [SUMMARY], regionCode: "GB" });
    expect(getTrendingMock).toHaveBeenCalledWith({ regionCode: "GB", maxResults: 10 });
  });

  it("defaults the region to US when none is supplied", async () => {
    getTrendingMock.mockResolvedValue([]);

    const response = await trendingRoute(request("/api/trending"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], regionCode: "US" });
    expect(getTrendingMock).toHaveBeenCalledWith({ regionCode: "US", maxResults: undefined });
  });

  it("returns 400 VALIDATION_FAILED for a bad region or maxResults before calling the client", async () => {
    for (const [query, field] of [
      ["?region=USA", "region"],
      ["?maxResults=0", "maxResults"],
      ["?maxResults=abc", "maxResults"],
    ] as const) {
      const response = await trendingRoute(request(`/api/trending${query}`));

      expect(response.status).toBe(400);
      const body = await errorBody(response);

      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.field).toBe(field);
    }

    expect(getTrendingMock).not.toHaveBeenCalled();
  });

  it("returns 429 RATE_LIMITED when the quota is exhausted", async () => {
    getTrendingMock.mockRejectedValue(
      new YouTubeApiError("quota", `quotaExceeded for key ${FAKE_KEY}`, { status: 403 }),
    );

    const response = await trendingRoute(request("/api/trending?region=US"));

    expect(response.status).toBe(429);
    expect((await errorBody(response)).error.code).toBe("RATE_LIMITED");
  });
});
