/**
 * GET /api/search?q=<terms>&pageToken=<token>
 *
 * The only public entry point to `searchVideos`. Input is validated before the
 * upstream call, and the normalized `SearchPage` is returned unchanged:
 *
 *   200 { items, nextPageToken, totalResults }
 *
 * Failures use the shared T07 envelope (`{ error: { code, message, field? } }`):
 *
 * | Thrown                          | Status | Code                |
 * | ------------------------------- | ------ | ------------------- |
 * | DomainValidationError           | 400    | VALIDATION_FAILED   |
 * | YouTubeApiError "quota"         | 429    | RATE_LIMITED        |
 * | YouTubeApiError "auth"          | 500    | CONFIGURATION_ERROR |
 * | YouTubeApiError upstream/network/timeout/bad_request/not_found | 502 | UPSTREAM_ERROR |
 * | Anything else                   | 500    | INTERNAL_ERROR      |
 *
 * Response bodies only ever contain authored copy: never the API key, the
 * outbound request URL or an upstream payload. Server detail stays in the log,
 * correlated by the id printed by `logServerError`.
 */

import { NextResponse } from "next/server";

import {
  type ApiErrorBody,
  type ApiErrorResult,
  apiErrorResult,
  jsonErrorResult,
  logServerError,
  mapErrorToResponse,
} from "@/lib/errors";
import { isYouTubeApiError, searchVideos } from "@/lib/youtube/client";
import type { YouTubeApiError } from "@/lib/youtube/client";
import type { SearchPage } from "@/shared/types";
import { assertSearchQuery, isDomainValidationError } from "@/shared/validation";

/** Log scope. Never include the query string: it is user input. */
const SCOPE = "GET /api/search";

/**
 * Search results are not user-specific, so a short shared cache absorbs repeat
 * queries and the accompanying page-token hops. Kept intentionally short because
 * results drift and every cache miss costs quota.
 */
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

/** Authored copy. None of these strings interpolate input, URLs or upstream text. */
const RATE_LIMITED_MESSAGE =
  "Search is temporarily unavailable because the YouTube API quota has been exceeded. Please try again later.";
const CONFIGURATION_ERROR_MESSAGE =
  "The server is not configured to run searches right now. Please try again later.";
const UPSTREAM_ERROR_MESSAGE = "Search is temporarily unavailable. Please try again later.";

export async function GET(request: Request): Promise<NextResponse<SearchPage | ApiErrorBody>> {
  const searchParams = new URL(request.url).searchParams;

  try {
    // Trimmed and rejected (empty, overlong, control characters) before any I/O.
    const query = assertSearchQuery(searchParams.get("q"));
    const pageToken = searchParams.get("pageToken");

    const page = await searchVideos({ query, pageToken });
    return NextResponse.json(page, {
      status: 200,
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Maps a thrown value to the envelope. `isYouTubeApiError` is checked first
 * because those failures need statuses the generic mapper cannot infer.
 */
function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (isYouTubeApiError(error)) {
    logServerError(error, {
      scope: SCOPE,
      details: {
        upstreamCode: error.code,
        upstreamStatus: error.status,
        upstreamReason: error.reason,
      },
    });

    return errorJson(mapYouTubeError(error));
  }

  if (isDomainValidationError(error)) {
    // Client mistake, fully explained by the envelope: no server log noise.
    return errorJson(mapErrorToResponse(error));
  }

  logServerError(error, SCOPE);
  return errorJson(mapErrorToResponse(error));
}

/** Client-side request rejections are still upstream failures, not server bugs. */
function mapYouTubeError(error: YouTubeApiError): ApiErrorResult {
  switch (error.code) {
    case "quota":
      return apiErrorResult("RATE_LIMITED", RATE_LIMITED_MESSAGE);
    case "auth":
      return apiErrorResult("CONFIGURATION_ERROR", CONFIGURATION_ERROR_MESSAGE);
    case "upstream":
    case "network":
    case "timeout":
    case "bad_request":
    case "not_found":
      return apiErrorResult("UPSTREAM_ERROR", UPSTREAM_ERROR_MESSAGE);
  }
}

/** Errors are never cacheable: a 429 or a 500 must not be replayed to other users. */
function errorJson(result: ApiErrorResult): NextResponse<ApiErrorBody> {
  const response = jsonErrorResult(result);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
