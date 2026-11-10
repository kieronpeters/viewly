import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// `errors.ts` -> `env.ts` and the real YouTube client both import the
// `server-only` marker, which throws outside a Server Component graph.
vi.mock("server-only", () => ({}));

// Mock only the network-facing call: the real `YouTubeApiError` class and its
// `isYouTubeApiError` guard are kept so the route's branching is exercised
// against the actual error type.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, listComments: vi.fn() };
});

import { GET } from "@/app/api/videos/[id]/comments/route";
import { EnvConfigurationError } from "@/lib/env";
import { YouTubeApiError, listComments } from "@/lib/youtube/client";
import type { CommentPage } from "@/shared/types";
import { DomainValidationError } from "@/shared/validation";

const VIDEO_ID = "dQw4w9WgXcQ";

const COMMENT_PAGE: CommentPage = {
  items: [
    {
      id: "UgxComment",
      author: "Ada Lovelace",
      text: "Great video!",
      likeCount: 12,
      publishedAt: "2026-01-02T03:04:05Z",
      replyCount: 3,
    },
  ],
  nextPageToken: "CAoQAA",
  commentsDisabled: false,
};

const DISABLED_PAGE: CommentPage = {
  items: [],
  nextPageToken: null,
  commentsDisabled: true,
};

/** Credential-shaped fake: exists only to prove it never reaches the response. */
const FAKE_KEY = "AIzaSyFAKE-comments-route-key-00000";

const listCommentsMock = vi.mocked(listComments);

/** Calls the handler the way Next does: a Request plus a params Promise. */
function callRoute(id: string, query = ""): Promise<Response> {
  const suffix = query === "" ? "" : `?${query}`;
  const request = new Request(
    `https://viewly.test/api/videos/${encodeURIComponent(id)}/comments${suffix}`,
  );
  return GET(request, { params: Promise.resolve({ id }) });
}

let errorLog: MockInstance;

beforeEach(() => {
  listCommentsMock.mockReset();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/videos/[id]/comments", () => {
  it("returns 200 with the normalized page and a short cache header", async () => {
    listCommentsMock.mockResolvedValue(COMMENT_PAGE);

    const response = await callRoute(VIDEO_ID, "pageToken=CAoQAA&maxResults=25");
    const body = (await response.json()) as CommentPage;

    expect(response.status).toBe(200);
    expect(body).toEqual(COMMENT_PAGE);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    expect(listCommentsMock).toHaveBeenCalledTimes(1);
    expect(listCommentsMock).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      pageToken: "CAoQAA",
      maxResults: 25,
    });
  });

  it("returns 200 with an explicit disabled page", async () => {
    listCommentsMock.mockResolvedValue(DISABLED_PAGE);

    const response = await callRoute(VIDEO_ID);
    const body = (await response.json()) as CommentPage;

    expect(response.status).toBe(200);
    expect(body).toEqual(DISABLED_PAGE);
    expect(body.commentsDisabled).toBe(true);
    expect(body.items).toEqual([]);
  });

  it("passes undefined for absent query parameters", async () => {
    listCommentsMock.mockResolvedValue(DISABLED_PAGE);

    await callRoute(VIDEO_ID, "maxResults=");

    expect(listCommentsMock).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      pageToken: null,
      maxResults: undefined,
    });
  });

  it("returns 400 for a malformed id without calling the client", async () => {
    const response = await callRoute("too-short");
    const body = (await response.json()) as {
      error: { code: string; message: string; field?: string };
    };

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("videoId");
    expect(listCommentsMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed page token without calling the client", async () => {
    const response = await callRoute(VIDEO_ID, "pageToken=not%20a%20token");

    expect(response.status).toBe(400);
    expect(listCommentsMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric maxResults without calling the client", async () => {
    const response = await callRoute(VIDEO_ID, "maxResults=lots");
    const body = (await response.json()) as {
      error: { code: string; message: string; field?: string };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("maxResults");
    expect(listCommentsMock).not.toHaveBeenCalled();
  });

  it("returns 429 RATE_LIMITED for an exhausted quota without leaking upstream detail", async () => {
    listCommentsMock.mockRejectedValue(
      new YouTubeApiError(
        "quota",
        "The YouTube API quota has been exceeded. (HTTP 403, reason: quotaExceeded).",
        { status: 403, reason: "quotaExceeded" },
      ),
    );

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(raw).toContain("RATE_LIMITED");
    expect(raw).not.toContain("quotaExceeded");
    expect(raw).not.toContain("googleapis.com");
    expect(raw).not.toContain("key=");
    expect(raw).not.toContain(FAKE_KEY);
    expect(errorLog).toHaveBeenCalled();
  });

  it("returns 502 UPSTREAM_ERROR for a real upstream fault without leaking detail", async () => {
    listCommentsMock.mockRejectedValue(
      new YouTubeApiError(
        "upstream",
        `YouTube returned an unexpected response for https://www.googleapis.com/youtube/v3/commentThreads?key=${FAKE_KEY}`,
        { status: 500, reason: "backendError" },
      ),
    );

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(raw).toContain("UPSTREAM_ERROR");
    expect(raw).not.toContain("backendError");
    expect(raw).not.toContain("googleapis.com");
    expect(raw).not.toContain("key=");
    expect(raw).not.toContain(FAKE_KEY);
    expect(errorLog).toHaveBeenCalled();
  });

  it("returns 502 UPSTREAM_ERROR when the upstream payload is malformed", async () => {
    listCommentsMock.mockRejectedValue(
      new DomainValidationError("malformed_payload", `Broken body ${FAKE_KEY}`),
    );

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(raw).toContain("UPSTREAM_ERROR");
    expect(raw).not.toContain("Broken body");
    expect(raw).not.toContain(FAKE_KEY);
  });

  it("returns 500 CONFIGURATION_ERROR when YouTube rejects the credentials", async () => {
    listCommentsMock.mockRejectedValue(
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
    expect(raw).not.toContain(FAKE_KEY);
  });

  it("returns 500 CONFIGURATION_ERROR when the key is missing", async () => {
    listCommentsMock.mockRejectedValue(
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
    listCommentsMock.mockRejectedValue(new Error(`boom ${FAKE_KEY} /internal/path`));

    const response = await callRoute(VIDEO_ID);
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(raw).toContain("INTERNAL_ERROR");
    expect(raw).not.toContain("boom");
    expect(raw).not.toContain("/internal/path");
    expect(raw).not.toContain(FAKE_KEY);
  });

  it("rethrows a Next prerender bailout from the upstream fetch without logging it", async () => {
    const bailout = Object.assign(
      new Error("Route /api/videos/[id]/comments needs to bail out of prerendering."),
      { digest: "NEXT_PRERENDER_INTERRUPTED" },
    );
    listCommentsMock.mockRejectedValue(bailout);

    await expect(callRoute(VIDEO_ID)).rejects.toBe(bailout);

    expect(errorLog).not.toHaveBeenCalled();
  });
});
