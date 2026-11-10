/**
 * GET /api/videos/[id]/comments?pageToken=<token>&maxResults=<n>
 *
 * Read-only top-level comments for the watch page's Comments tab. The endpoint
 * never posts, authenticates or touches an account: it is one server-side
 * `commentThreads.list` call, ordered by relevance, using the server's YouTube
 * API key. The key, the outbound URL and the upstream body never leave the
 * server.
 *
 * Success body is the normalized `CommentPage`:
 *
 *   200 { items, nextPageToken, commentsDisabled }
 *
 * Disabled comments are a successful, explicit outcome (`commentsDisabled:
 * true`, empty items) rather than an error, so the UI can explain the state and
 * still offer the "Comment on YouTube" link.
 *
 * Failure mapping mirrors `/api/videos/[id]` and the other YouTube routes:
 *
 * | Condition                              | Status | Code                |
 * | -------------------------------------- | ------ | ------------------- |
 * | id/pageToken/maxResults fails validation| 400   | VALIDATION_FAILED   |
 * | `YouTubeApiError` with code "quota"    | 429    | RATE_LIMITED        |
 * | `YouTubeApiError` with code "auth"     | 500    | CONFIGURATION_ERROR |
 * | any other `YouTubeApiError`            | 502    | UPSTREAM_ERROR      |
 * | malformed upstream payload             | 502    | UPSTREAM_ERROR      |
 * | `EnvConfigurationError`                | 500    | CONFIGURATION_ERROR |
 * | anything else                          | 500    | INTERNAL_ERROR      |
 */

import { NextResponse } from "next/server";

import {
  type ApiErrorBody,
  type ApiErrorResult,
  apiErrorResult,
  jsonError,
  jsonErrorResult,
  logServerError,
  rethrowNextControlFlow,
} from "@/lib/errors";
import { isYouTubeApiError, listComments } from "@/lib/youtube/client";
import type { YouTubeApiErrorCode } from "@/lib/youtube/client";
import type { CommentPage } from "@/shared/types";
import {
  DomainValidationError,
  assertPageToken,
  assertVideoId,
  isDomainValidationError,
} from "@/shared/validation";

/** Log scope. Neither the id nor the page token is included. */
const SCOPE = "GET /api/videos/[id]/comments";

/**
 * Comments are display data that changes quickly. A short shared cache absorbs
 * the panel's remounts and the Next.js prefetch, while the client-side
 * five-minute cache absorbs pagination and tab switches.
 */
const CACHE_CONTROL = "public, max-age=60, s-maxage=300";

/** Copy for an exhausted quota. Retryable, so it must not read like a fault. */
const RATE_LIMITED_MESSAGE =
  "Comments are temporarily unavailable because the YouTube API quota has been exceeded. Please try again later.";

/** Copy for rejected credentials. Never names the variable or its value. */
const AUTH_ERROR_MESSAGE =
  "The server is not configured for the video service. Please try again later.";

/** Copy for a rejected upstream request. Deliberately vague. */
const UPSTREAM_ERROR_MESSAGE = "Comments are temporarily unavailable. Please try again shortly.";

/**
 * HTTP result for every client failure code. Keyed by the union, so adding a
 * client code becomes a compile error here instead of an unhandled case.
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
interface CommentsRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  { params }: CommentsRouteContext,
): Promise<NextResponse<CommentPage> | NextResponse<ApiErrorBody>> {
  try {
    const { id } = await params;
    const searchParams = new URL(request.url).searchParams;

    // Validate everything before any network work. `assertPageToken` normalizes
    // absent/empty tokens to null and rejects hostile values.
    const videoId = assertVideoId(id);
    const pageToken = assertPageToken(searchParams.get("pageToken"));
    const maxResults = parseMaxResults(searchParams.get("maxResults"));

    const page = await listComments({ videoId, pageToken, maxResults });

    return NextResponse.json(page, {
      status: 200,
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    // `params` and `request.url` are request-scoped, so Next may signal a
    // prerender bailout by throwing here. That is control flow, not a failure.
    rethrowNextControlFlow(error);
    return errorResponse(error);
  }
}

/**
 * Reads an optional page size. The client applies the final 1..100 clamp; this
 * only rejects values that are not numbers at all, with the field name the
 * caller needs to fix the request.
 */
function parseMaxResults(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DomainValidationError("invalid_format", "maxResults must be a number.", {
      field: "maxResults",
    });
  }

  return parsed;
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
