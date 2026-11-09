/**
 * Tests for GET /api/trending.
 *
 * `@/lib/youtube/client` is partially mocked: `getTrending` is a spy while the
 * real `YouTubeApiError` class stays in place, so the error mapping under test
 * uses the same `instanceof` path as production. `server-only` is stubbed
 * because Vitest is not a Server Component graph, same as the client's own tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, getTrending: vi.fn() };
});

import { GET } from "@/app/api/trending/route";
import { YouTubeApiError, getTrending } from "@/lib/youtube/client";
import type { VideoSummary } from "@/shared/types";
import { DomainValidationError } from "@/shared/validation";

const getTrendingMock = vi.mocked(getTrending);

const ORIGINAL_REGION_ENV = process.env.YOUTUBE_REGION;

const SAMPLE_VIDEO: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_600_000_000,
};

/** Request shaped like one Next hands to the handler. */
function trendingRequest(query = ""): Request {
  return new Request(`http://localhost/api/trending${query}`);
}

/** Reads the JSON error envelope. */
async function readError(response: Response): Promise<{
  error: { code: string; message: string; field?: string };
}> {
  return (await response.json()) as {
    error: { code: string; message: string; field?: string };
  };
}

beforeEach(() => {
  getTrendingMock.mockReset();
  delete process.env.YOUTUBE_REGION;
  // Failures log server-side; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();

  if (ORIGINAL_REGION_ENV === undefined) {
    delete process.env.YOUTUBE_REGION;
  } else {
    process.env.YOUTUBE_REGION = ORIGINAL_REGION_ENV;
  }
});

describe("GET /api/trending", () => {
  it("returns 200 with items for the default region", async () => {
    getTrendingMock.mockResolvedValue([SAMPLE_VIDEO]);

    const response = await GET(trendingRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");

    await expect(response.json()).resolves.toEqual({
      items: [SAMPLE_VIDEO],
      regionCode: "US",
    });
    expect(getTrendingMock).toHaveBeenCalledExactlyOnceWith({
      regionCode: "US",
      maxResults: undefined,
    });
  });

  it("uppercases an explicit region and forwards it with maxResults", async () => {
    getTrendingMock.mockResolvedValue([SAMPLE_VIDEO]);

    const response = await GET(trendingRequest("?region=gb&maxResults=12"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [SAMPLE_VIDEO],
      regionCode: "GB",
    });
    expect(getTrendingMock).toHaveBeenCalledExactlyOnceWith({
      regionCode: "GB",
      maxResults: 12,
    });
  });

  it("falls back to a valid YOUTUBE_REGION default", async () => {
    process.env.YOUTUBE_REGION = "nz";
    getTrendingMock.mockResolvedValue([]);

    const response = await GET(trendingRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], regionCode: "NZ" });
    expect(getTrendingMock).toHaveBeenCalledExactlyOnceWith({
      regionCode: "NZ",
      maxResults: undefined,
    });
  });

  it("ignores an invalid YOUTUBE_REGION default and uses US", async () => {
    process.env.YOUTUBE_REGION = "not-a-region";
    getTrendingMock.mockResolvedValue([]);

    const response = await GET(trendingRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], regionCode: "US" });
    expect(getTrendingMock).toHaveBeenCalledExactlyOnceWith({
      regionCode: "US",
      maxResults: undefined,
    });
  });

  it.each(["USA", "U", "12", " ", "u1", ""])(
    "rejects the invalid region %j with 400 without calling the client",
    async (region) => {
      const response = await GET(trendingRequest(`?region=${encodeURIComponent(region)}`));

      expect(response.status).toBe(400);
      const { error } = await readError(response);
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.field).toBe("region");
      expect(getTrendingMock).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "51", "abc", "1.5", "-5", "50.0", ""])(
    "rejects the invalid maxResults %j with 400 without calling the client",
    async (maxResults) => {
      const response = await GET(trendingRequest(`?maxResults=${encodeURIComponent(maxResults)}`));

      expect(response.status).toBe(400);
      const { error } = await readError(response);
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.field).toBe("maxResults");
      expect(getTrendingMock).not.toHaveBeenCalled();
    },
  );

  it.each([1, 25, 50])("accepts maxResults %i", async (maxResults) => {
    getTrendingMock.mockResolvedValue([]);

    const response = await GET(trendingRequest(`?maxResults=${maxResults}`));

    expect(response.status).toBe(200);
    expect(getTrendingMock).toHaveBeenCalledExactlyOnceWith({
      regionCode: "US",
      maxResults,
    });
  });

  it("maps a YouTube upstream failure to 502 UPSTREAM_ERROR without leaking detail", async () => {
    getTrendingMock.mockRejectedValue(
      new YouTubeApiError("upstream", "YouTube returned an unexpected response. (HTTP 500)", {
        status: 500,
      }),
    );

    const response = await GET(trendingRequest());

    expect(response.status).toBe(502);
    const { error } = await readError(response);
    expect(error.code).toBe("UPSTREAM_ERROR");

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("HTTP 500");
    expect(serialized).not.toContain("googleapis");
    expect(serialized).not.toContain("AIza");
    expect(console.error).toHaveBeenCalled();
  });

  it.each([
    ["quota", 429, "RATE_LIMITED"],
    ["network", 502, "UPSTREAM_ERROR"],
    ["timeout", 502, "UPSTREAM_ERROR"],
    ["upstream", 502, "UPSTREAM_ERROR"],
    ["bad_request", 502, "UPSTREAM_ERROR"],
    ["not_found", 502, "UPSTREAM_ERROR"],
    ["auth", 500, "CONFIGURATION_ERROR"],
  ] as const)("maps the YouTube %s code to %i %s", async (code, status, errorCode) => {
    getTrendingMock.mockRejectedValue(new YouTubeApiError(code, "authored upstream copy."));

    const response = await GET(trendingRequest());

    expect(response.status).toBe(status);
    const { error } = await readError(response);
    expect(error.code).toBe(errorCode);
    expect(error.message).not.toContain("authored upstream copy.");
  });

  it("maps a client validation error to 400 VALIDATION_FAILED", async () => {
    getTrendingMock.mockRejectedValue(
      new DomainValidationError("invalid_format", "Region code must be two letters.", {
        field: "regionCode",
      }),
    );

    const response = await GET(trendingRequest());

    expect(response.status).toBe(400);
    const { error } = await readError(response);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.field).toBe("regionCode");
  });

  it("maps a malformed upstream payload to 502 UPSTREAM_ERROR", async () => {
    getTrendingMock.mockRejectedValue(
      new DomainValidationError("malformed_payload", "Video response must contain an items array."),
    );

    const response = await GET(trendingRequest());

    expect(response.status).toBe(502);
    const { error } = await readError(response);
    expect(error.code).toBe("UPSTREAM_ERROR");
    // Not caller input: no field and none of the normalizer's wording.
    expect(error.field).toBeUndefined();
    expect(error.message).not.toContain("items array");
    expect(console.error).toHaveBeenCalled();
  });

  it("keeps region validation as 400 even though the client also throws DomainValidationError", async () => {
    const response = await GET(trendingRequest("?region=USA"));

    expect(response.status).toBe(400);
    const { error } = await readError(response);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.field).toBe("region");
    expect(getTrendingMock).not.toHaveBeenCalled();
  });

  it("maps an unexpected thrown value to 500 INTERNAL_ERROR", async () => {
    getTrendingMock.mockRejectedValue(new Error("socket /secret?key=AIza-leaked-value-000000"));

    const response = await GET(trendingRequest());

    expect(response.status).toBe(500);
    const { error } = await readError(response);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(error)).not.toContain("AIza");
    expect(JSON.stringify(error)).not.toContain("socket");
  });
});
