/**
 * GET /api/videos/[id] — one video's details for the watch page.
 *
 * Thin by design: validate the route param, call the client once, return one
 * response. Caching, quota bookkeeping and UI concerns stay elsewhere.
 *
 * Status mapping (never invents a code, always uses the shared envelope):
 *
 * | Condition                              | Status | Code                |
 * | -------------------------------------- | ------ | ------------------- |
 * | id fails `assertVideoId`               | 400    | VALIDATION_FAILED   |
 * | `getVideo` resolves to null            | 404    | NOT_FOUND           |
 * | `YouTubeApiError` with code "quota"    | 429    | RATE_LIMITED        |
 * | `YouTubeApiError` with code "auth"     | 500    | CONFIGURATION_ERROR |
 * | any other `YouTubeApiError`            | 502    | UPSTREAM_ERROR      |
 * | malformed upstream payload             | 502    | UPSTREAM_ERROR      |
 * | `EnvConfigurationError`                | 500    | CONFIGURATION_ERROR |
 * | anything else                          | 500    | INTERNAL_ERROR      |
 *
 * `quota` is a 429 rather than a 502 because the caller may retry once quota
 * resets; a 502 would suggest the upstream is faulty. This matches `/api/search`
 * and `/api/trending`, so every route reports exhaustion the same way.
 *
 * The success body is the normalized `VideoDetail`; no upstream payload ever
 * reaches the browser. Failure copy is authored here, so the API key, the
 * request URL and the upstream response body cannot leak through an error.
 */

import { NextResponse } from "next/server";

import {
  apiErrorResult,
  jsonError,
  jsonErrorResult,
  logServerError,
  type ApiErrorBody,
  type ApiErrorResult,
} from "@/lib/errors";
import { getVideo, isYouTubeApiError } from "@/lib/youtube/client";
import type { YouTubeApiErrorCode } from "@/lib/youtube/client";
import type { VideoDetail } from "@/shared/types";
import { assertVideoId, isDomainValidationError } from "@/shared/validation";

/** Log scope. The id is a path param, so it is never included here. */
const SCOPE = "GET /api/videos/[id]";

/** Short shared cache: a video's metadata changes rarely, but not never. */
const CACHE_CONTROL = "public, max-age=60, s-maxage=300";

/** Copy for a lookup that YouTube answered with no usable item. */
const NOT_FOUND_MESSAGE =
  "That video could not be found. It may be private, deleted or unavailable.";

/** Copy for a rejected upstream request. Deliberately vague. */
const UPSTREAM_ERROR_MESSAGE =
  "The video service is unavailable right now. Please try again shortly.";

/** Copy for an exhausted quota. Retryable, so it must not read like a fault. */
const RATE_LIMITED_MESSAGE =
  "Video details are temporarily unavailable because the YouTube API quota has been exceeded. Please try again later.";

/** Copy for rejected credentials. Never names the variable or its value. */
const AUTH_ERROR_MESSAGE =
  "The server is not configured for the video service. Please try again later.";

/**
 * HTTP result for each `YouTubeApiError` code. A `Record` keyed by the union
 * makes the mapping exhaustive: adding a client code is a compile error here.
 *
 * - `quota` is 429 RATE_LIMITED: capacity, not a fault, and retryable.
 * - `auth` is our misconfiguration, so it must never look like a client error.
 * - The rest mean the upstream did not answer usefully: 502 UPSTREAM_ERROR.
 */
const YOUTUBE_FAILURE_RESULTS: Record<YouTubeApiErrorCode, ApiErrorResult> = {
  quota: apiErrorResult("RATE_LIMITED", RATE_LIMITED_MESSAGE),
  auth: apiErrorResult("CONFIGURATION_ERROR", AUTH_ERROR_MESSAGE),
  bad_request: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_ERROR_MESSAGE),
  not_found: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_ERROR_MESSAGE),
  upstream: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_ERROR_MESSAGE),
  network: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_ERROR_MESSAGE),
  timeout: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_ERROR_MESSAGE),
};

/** Route params. Next 16 hands these over as a Promise. */
interface VideoRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  { params }: VideoRouteContext,
): Promise<NextResponse<VideoDetail> | NextResponse<ApiErrorBody>> {
  try {
    const { id } = await params;

    // Validate before any network work: a malformed id never reaches the client.
    const videoId = assertVideoId(id);

    const video = await getVideo(videoId);

    if (video === null) {
      return jsonErrorResult(apiErrorResult("NOT_FOUND", NOT_FOUND_MESSAGE));
    }

    return NextResponse.json(video, {
      status: 200,
      headers: { "cache-control": CACHE_CONTROL },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Maps a thrown value to the shared envelope. Validation failures are expected
 * client mistakes and are not logged; everything else is logged with redaction
 * and mapped from safe, authored copy.
 */
function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (isDomainValidationError(error)) {
    return jsonError(error);
  }

  if (isYouTubeApiError(error)) {
    // `status` and `reason` are stable identifiers, never the URL or the key.
    logServerError(error, { scope: SCOPE, details: { code: error.code, status: error.status } });

    return jsonErrorResult(YOUTUBE_FAILURE_RESULTS[error.code]);
  }

  // EnvConfigurationError and unknown failures: the shared mapper supplies
  // generic copy and keeps the original message server-side.
  logServerError(error, SCOPE);
  return jsonError(error);
}
