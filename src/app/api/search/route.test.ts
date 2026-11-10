import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` deliberately throws when imported outside a Server Component
// graph; Vitest is not one, so the marker module is mocked here.
vi.mock("server-only", () => ({}));

// The route must be tested without the network: only `searchVideos` is replaced,
// so the real `YouTubeApiError` class (and its codes) is still exercised.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, searchVideos: vi.fn() };
});

import { GET } from "@/app/api/search/route";
import type { ApiErrorBody } from "@/lib/errors";
import { YouTubeApiError, searchVideos } from "@/lib/youtube/client";
import type { SearchPage, VideoSummary } from "@/shared/types";

/** Credential-shaped fake: only used to prove it never reaches a response body. */
const FAKE_KEY = "AIzaSyFAKE-route-test-key-000000";

const SUMMARY: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1500000000,
};

const PAGE: SearchPage = {
  items: [SUMMARY],
  nextPageToken: "CAoQAA",
  totalResults: 1234,
};

const searchVideosMock = vi.mocked(searchVideos);

function get(search = ""): Promise<Response> {
  return GET(new Request(`https://viewly.test/api/search${search}`));
}

async function errorBody(response: Response): Promise<ApiErrorBody> {
  return (await response.json()) as ApiErrorBody;
}

/**
 * Mimics the error Next throws when a handler touches a Request-time API
 * (`fetch` is patched during prerender) while Next is trying to prerender it.
 */
function nextPrerenderBailout(): Error {
  return Object.assign(
    new Error(
      "Route /api/search needs to bail out of prerendering at this point because it used fetch.",
    ),
    { digest: "NEXT_PRERENDER_INTERRUPTED" },
  );
}

beforeEach(() => {
  searchVideosMock.mockReset();
  // Any attempt to reach the network is a test bug, not a fallback.
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.reject(new Error("Network access is not allowed in this test.")),
  );
  // The route logs upstream failures by design; keep the test output quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/search", () => {
  it("returns the normalized SearchPage with a short cache header", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    const response = await get(
      `?q=${encodeURIComponent("  never gonna give you up  ")}&pageToken=CAoQAA`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    await expect(response.json()).resolves.toEqual({
      items: [SUMMARY],
      nextPageToken: "CAoQAA",
      totalResults: 1234,
    });
  });

  it("forwards the trimmed query and the page token", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    await get(`?q=${encodeURIComponent("  rick astley  ")}&pageToken=CAoQAA`);

    expect(searchVideosMock).toHaveBeenCalledTimes(1);
    expect(searchVideosMock).toHaveBeenCalledWith({
      query: "rick astley",
      pageToken: "CAoQAA",
    });
  });

  it("passes a null page token for the first page", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    await get("?q=rick");

    expect(searchVideosMock).toHaveBeenCalledWith({ query: "rick", pageToken: null });
  });

  it("forwards validated duration, order and upload-date filters", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    await get("?q=rick&duration=short&order=viewCount&uploadDate=week");

    expect(searchVideosMock).toHaveBeenCalledWith({
      query: "rick",
      pageToken: null,
      duration: "short",
      order: "viewCount",
      uploadDate: "week",
    });
  });

  it("accepts each documented filter value", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    for (const duration of ["any", "short", "medium", "long"]) {
      await get(`?q=rick&duration=${duration}`);
    }
    for (const order of ["relevance", "date", "viewCount"]) {
      await get(`?q=rick&order=${order}`);
    }
    for (const uploadDate of ["any", "day", "week", "month"]) {
      await get(`?q=rick&uploadDate=${uploadDate}`);
    }

    expect(searchVideosMock).toHaveBeenCalledTimes(11);
  });

  it.each([
    ["duration", "tiny", "duration"],
    ["duration", "SHORT", "duration"],
    ["order", "popular", "order"],
    ["order", "viewcount", "order"],
    ["uploadDate", "year", "uploadDate"],
  ] as const)("returns 400 VALIDATION_FAILED for %s=%s", async (name, value, field) => {
    const response = await get(`?q=rick&${name}=${value}`);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await errorBody(response);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe(field);
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED when q is missing", async () => {
    const response = await get();

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await errorBody(response);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("searchQuery");
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED when q is blank", async () => {
    const response = await get("?q=%20%20%20");

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("searchQuery");
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED when q contains control characters", async () => {
    const response = await get("?q=rick%00astley");

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_FAILED");
    expect(searchVideosMock).not.toHaveBeenCalled();
  });

  it("returns 429 RATE_LIMITED when the YouTube quota is exhausted", async () => {
    searchVideosMock.mockRejectedValue(
      new YouTubeApiError(
        "quota",
        `The YouTube API quota has been exceeded (HTTP 403, reason: quotaExceeded): https://www.googleapis.com/youtube/v3/search?key=${FAKE_KEY}`,
        { status: 403, reason: "quotaExceeded" },
      ),
    );

    const response = await get("?q=rick");

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await errorBody(response);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(body)).not.toContain("googleapis.com");
    expect(JSON.stringify(body)).not.toContain("quotaExceeded");
  });

  it("returns 502 UPSTREAM_ERROR when YouTube reports an upstream failure", async () => {
    searchVideosMock.mockRejectedValue(
      new YouTubeApiError(
        "upstream",
        `YouTube returned an unexpected response. body: {"error":{"message":"backend error"}} url: https://www.googleapis.com/youtube/v3/search?key=${FAKE_KEY}`,
        { status: 503, reason: "backendError" },
      ),
    );

    const response = await get("?q=rick");

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await errorBody(response);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(body)).not.toContain("backend error");
    expect(JSON.stringify(body)).not.toContain("googleapis.com");
  });

  it("returns 502 UPSTREAM_ERROR for network and timeout failures", async () => {
    for (const code of ["network", "timeout"] as const) {
      searchVideosMock.mockRejectedValue(new YouTubeApiError(code, code));

      const response = await get("?q=rick");

      expect(response.status).toBe(502);
      expect((await errorBody(response)).error.code).toBe("UPSTREAM_ERROR");
    }
  });

  it("returns 502 UPSTREAM_ERROR when YouTube rejects the request or reports not found", async () => {
    for (const code of ["bad_request", "not_found"] as const) {
      searchVideosMock.mockRejectedValue(
        new YouTubeApiError(
          code,
          `YouTube rejected https://www.googleapis.com/youtube/v3/search?key=${FAKE_KEY}`,
          {
            status: 400,
            reason: "badRequest",
          },
        ),
      );

      const response = await get("?q=rick");

      expect(response.status).toBe(502);
      const body = await errorBody(response);
      expect(body.error.code).toBe("UPSTREAM_ERROR");
      expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
      expect(JSON.stringify(body)).not.toContain("googleapis.com");
    }
  });

  it("returns 500 CONFIGURATION_ERROR when YouTube rejects the credentials", async () => {
    searchVideosMock.mockRejectedValue(
      new YouTubeApiError("auth", `keyInvalid for key ${FAKE_KEY}`, {
        status: 400,
        reason: "keyInvalid",
      }),
    );

    const response = await get("?q=rick");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await errorBody(response);
    expect(body.error.code).toBe("CONFIGURATION_ERROR");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(body)).not.toContain("keyInvalid");
  });

  it("returns 500 INTERNAL_ERROR for an unexpected failure without echoing it", async () => {
    searchVideosMock.mockRejectedValue(new Error(`boom ${FAKE_KEY}`));

    const response = await get("?q=rick");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await errorBody(response);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("rethrows a Next prerender bailout instead of logging or answering it", async () => {
    const bailout = nextPrerenderBailout();
    searchVideosMock.mockRejectedValue(bailout);

    await expect(get("?q=rick")).rejects.toBe(bailout);

    // The bailout is control flow: no phantom [api-error] and no 500 envelope.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never calls fetch directly", async () => {
    searchVideosMock.mockResolvedValue(PAGE);

    await get("?q=rick");

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
