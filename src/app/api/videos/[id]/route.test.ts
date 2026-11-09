import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// `errors.ts` -> `env.ts` and the real YouTube client both import the
// `server-only` marker, which throws outside a Server Component graph.
vi.mock("server-only", () => ({}));

// Mock only the network-facing call: the real `YouTubeApiError` class and its
// `isYouTubeApiError` guard are kept so the route's branching is exercised
// against the actual error type.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, getVideo: vi.fn() };
});

import { GET } from "@/app/api/videos/[id]/route";
import { EnvConfigurationError } from "@/lib/env";
import { YouTubeApiError, getVideo } from "@/lib/youtube/client";
import type { VideoDetail } from "@/shared/types";
import { DomainValidationError } from "@/shared/validation";

const VIDEO_ID = "dQw4w9WgXcQ";

const VIDEO: VideoDetail = {
  id: VIDEO_ID,
  title: "Never Gonna Give You Up",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_500_000_000,
  description: "The official music video.",
};

/** Credential-shaped fake: exists only to prove it never reaches the response. */
const FAKE_KEY = "AIzaSyFAKE-route-test-key-0000000";

const getVideoMock = vi.mocked(getVideo);

/** Calls the handler the way Next does: a Request plus a params Promise. */
function callRoute(id: string): Promise<Response> {
  const request = new Request(`https://viewly.test/api/videos/${encodeURIComponent(id)}`);
  return GET(request, { params: Promise.resolve({ id }) });
}

let errorLog: MockInstance;

beforeEach(() => {
  getVideoMock.mockReset();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/videos/[id]", () => {
  it("returns 200 with the video detail and a short cache header", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    const response = await callRoute(VIDEO_ID);
    const body = (await response.json()) as VideoDetail;

    expect(response.status).toBe(200);
    expect(body).toEqual(VIDEO);
    expect(body.title).toBe("Never Gonna Give You Up");
    expect(body.description).toBe("The official music video.");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    expect(getVideoMock).toHaveBeenCalledTimes(1);
    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
  });

  it("returns 400 for a malformed id without calling the client", async () => {
    const response = await callRoute("too-short");
    const body = (await response.json()) as {
      error: { code: string; message: string; field?: string };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("videoId");
    expect(body.error.message).toContain("Video id");
    expect(getVideoMock).not.toHaveBeenCalled();
  });

  it("returns 404 with readable copy when the video does not exist", async () => {
    getVideoMock.mockResolvedValue(null);

    const response = await callRoute(VIDEO_ID);
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.message).toContain("video");
    expect(body).not.toHaveProperty("error.field");
  });

  it("returns 429 RATE_LIMITED for an exhausted quota without leaking upstream detail", async () => {
    getVideoMock.mockRejectedValue(
      new YouTubeApiError(
        "quota",
        "The YouTube API quota has been exceeded. (HTTP 403, reason: quotaExceeded).",
        { status: 403, reason: "quotaExceeded" },
      ),
    );

    const response = await callRoute(VIDEO_ID);
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message.length).toBeGreaterThan(0);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain("quotaExceeded");
    expect(raw).not.toContain("googleapis.com");
    expect(raw).not.toContain("key=");
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain("HTTP 403");
    // The failure is still logged, redacted, on the server.
    expect(errorLog).toHaveBeenCalled();
  });

  it("returns 502 UPSTREAM_ERROR for a real upstream fault without leaking detail", async () => {
    getVideoMock.mockRejectedValue(
      new YouTubeApiError(
        "upstream",
        `YouTube returned an unexpected response for https://www.googleapis.com/youtube/v3/videos?key=${FAKE_KEY}`,
        { status: 500, reason: "backendError" },
      ),
    );

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(raw).toContain("UPSTREAM_ERROR");
    expect(raw).not.toContain("RATE_LIMITED");
    expect(raw).not.toContain("backendError");
    expect(raw).not.toContain("googleapis.com");
    expect(raw).not.toContain("key=");
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain("unexpected response");
    expect(errorLog).toHaveBeenCalled();
  });

  it("returns 502 UPSTREAM_ERROR when the upstream payload is malformed", async () => {
    getVideoMock.mockRejectedValue(
      new DomainValidationError(
        "malformed_payload",
        `Could not read item ${FAKE_KEY} from the upstream body.`,
        { field: "videoId" },
      ),
    );

    const response = await callRoute(VIDEO_ID);
    const body = (await response.json()) as {
      error: { code: string; message: string; field?: string };
    };
    const raw = JSON.stringify(body);

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(raw).not.toContain("upstream body");
    expect(raw).not.toContain(FAKE_KEY);
    // `malformed_payload` is not the caller's mistake, so it carries no field.
    expect(body).not.toHaveProperty("error.field");
  });

  it("returns 500 CONFIGURATION_ERROR when YouTube rejects the credentials", async () => {
    getVideoMock.mockRejectedValue(
      new YouTubeApiError("auth", "YouTube rejected the API credentials.", {
        status: 403,
        reason: "keyInvalid",
      }),
    );

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(raw).toContain("CONFIGURATION_ERROR");
    expect(raw).not.toContain("keyInvalid");
    expect(raw).not.toContain("YOUTUBE_API_KEY");
    expect(raw).not.toContain(FAKE_KEY);
  });

  it("returns 500 CONFIGURATION_ERROR when the key is missing", async () => {
    getVideoMock.mockRejectedValue(
      new EnvConfigurationError(
        "missing_youtube_api_key",
        `YOUTUBE_API_KEY is set to ${FAKE_KEY} in .env.local`,
      ),
    );

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(raw).toContain("CONFIGURATION_ERROR");
    expect(raw).not.toContain("YOUTUBE_API_KEY");
    expect(raw).not.toContain(".env.local");
    expect(raw).not.toContain(FAKE_KEY);
  });

  it("returns 500 INTERNAL_ERROR for an unexpected failure without its text", async () => {
    getVideoMock.mockRejectedValue(new Error(`boom ${FAKE_KEY} /internal/path`));

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(raw).toContain("INTERNAL_ERROR");
    expect(raw).not.toContain("boom");
    expect(raw).not.toContain("/internal/path");
    expect(raw).not.toContain(FAKE_KEY);
  });
});
