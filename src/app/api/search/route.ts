/**
 * GET /api/search?q=<terms>&pageToken=<token>&duration=<bucket>&order=<order>&uploadDate=<window>
 *
 * The only public entry point to `searchVideos`. Input is validated before the
 * upstream call, and the normalized `SearchPage` is returned unchanged:
 *
 *   200 { items, nextPageToken, totalResults }
 *
 * Filters are optional and default to `any` / `relevance` / `any`:
 *
 * | Parameter    | Values                          | Upstream parameter |
 * | ------------ | ------------------------------- | ------------------ |
 * | `duration`   | any, short, medium, long        | `videoDuration`    |
 * | `order`      | relevance, date, viewCount      | `order`            |
 * | `uploadDate` | any, day, week, month           | `publishedAfter`   |
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
  rethrowNextControlFlow,
} from "@/lib/errors";
import { isYouTubeApiError, searchVideos } from "@/lib/youtube/client";
import type { YouTubeApiError } from "@/lib/youtube/client";
import { nonDefaultSearchFilters, resolveSearchFilters } from "@/shared/search-filters";
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
    // All three filters are validated together, so one bad value names its own
    // field and nothing reaches the upstream client.
    const filters = resolveSearchFilters({
      duration: searchParams.get("duration"),
      order: searchParams.get("order"),
      uploadDate: searchParams.get("uploadDate"),
    });

    const page = await searchVideos({ query, pageToken, ...nonDefaultSearchFilters(filters) });
    return NextResponse.json(page, {
      status: 200,
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    // A Next prerender bailout is control flow, not an API failure: let it
    // propagate instead of logging it and answering with an envelope.
    rethrowNextControlFlow(error);
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

    return jsonErrorResult(mapYouTubeError(error));
  }

  if (isDomainValidationError(error)) {
    // Client mistake, fully explained by the envelope: no server log noise.
    return jsonErrorResult(mapErrorToResponse(error));
  }

  logServerError(error, SCOPE);
  return jsonErrorResult(mapErrorToResponse(error));
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
