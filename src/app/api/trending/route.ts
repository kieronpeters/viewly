/**
 * GET /api/trending — most popular videos for a region.
 *
 * Query parameters (both optional):
 *   - `region`      two letters, any case; uppercased before the upstream call.
 *                   Falls back to `YOUTUBE_REGION` when that is a valid code,
 *                   then to `US`.
 *   - `maxResults`  integer 1..50, forwarded to the YouTube client.
 *
 * Success: `200 { items, regionCode }` with a short shared-cache header. The
 * resolved `regionCode` is echoed so a caller using the default knows what it got.
 *
 * Failures use the shared `{ error: { code, message, field? } }` envelope. Only
 * authored copy reaches the browser: the API key, the outbound URL and the
 * upstream body are never echoed, and upstream detail is logged (redacted) only.
 *
 * `YOUTUBE_REGION` is deliberately read here instead of `src/lib/env.ts`: it is
 * an optional presentation default, not a required secret, and adding it to the
 * validated env module would change startup behavior for no gain.
 */

import { NextResponse } from "next/server";

import { apiErrorResult, jsonError, jsonErrorResult, logServerError } from "@/lib/errors";
import { type YouTubeApiErrorCode, getTrending, isYouTubeApiError } from "@/lib/youtube/client";
import type { ApiErrorBody, ApiErrorResult } from "@/lib/errors";
import type { VideoSummary } from "@/shared/types";
import { DomainValidationError, isDomainValidationError } from "@/shared/validation";

/** Default region when neither the query nor `YOUTUBE_REGION` supplies one. */
const DEFAULT_REGION_CODE = "US";

/** Optional environment default for the region; validated on every request. */
const REGION_ENV_VAR = "YOUTUBE_REGION";

/** ISO 3166-1 alpha-2 country code, any case. */
const REGION_PATTERN = /^[A-Za-z]{2}$/;

/** Smallest accepted `maxResults` (YouTube rejects zero). */
const MIN_MAX_RESULTS = 1;

/** Largest accepted `maxResults` for `videos.list`. */
const MAX_MAX_RESULTS = 50;

/** Query values must be plain decimal digits: no sign, space, or decimal point. */
const DIGITS_PATTERN = /^\d+$/;

/** Short shared cache: trending changes slowly, and quota is finite. */
const CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=120";

/** Scope label for server logs. Never includes the query string. */
const LOG_SCOPE = "GET /api/trending";

/** Browser-safe copy for an upstream outage. Never names the service internals. */
const UPSTREAM_MESSAGE = "Trending videos are temporarily unavailable. Please try again later.";

/** Browser-safe copy for an exhausted quota. Never mentions the API key. */
const RATE_LIMITED_MESSAGE = "Too many trending requests right now. Please try again shortly.";

/** Matches the generic copy used by `src/lib/errors.ts` for CONFIGURATION_ERROR. */
const CONFIGURATION_MESSAGE =
  "The server is missing required configuration. Please try again later.";

/**
 * HTTP result for each `YouTubeApiError` code.
 *
 * - `quota` maps to 429 RATE_LIMITED: the caller may retry, and the copy avoids
 *   naming the key or the upstream.
 * - `auth` means our key is missing or rejected: a server misconfiguration, so
 *   it must not surface as a client error.
 * - transport failures and a rejected request are all "the upstream did not
 *   answer usefully" from the caller's point of view.
 */
const YOUTUBE_FAILURE_RESULTS: Record<YouTubeApiErrorCode, ApiErrorResult> = {
  quota: apiErrorResult("RATE_LIMITED", RATE_LIMITED_MESSAGE),
  auth: apiErrorResult("CONFIGURATION_ERROR", CONFIGURATION_MESSAGE),
  bad_request: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_MESSAGE),
  not_found: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_MESSAGE),
  upstream: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_MESSAGE),
  network: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_MESSAGE),
  timeout: apiErrorResult("UPSTREAM_ERROR", UPSTREAM_MESSAGE),
};

/**
 * A payload we could not normalize is the upstream's fault, not the caller's,
 * even though the client signals it with a `DomainValidationError`.
 */
const MALFORMED_PAYLOAD_RESULT: ApiErrorResult = apiErrorResult("UPSTREAM_ERROR", UPSTREAM_MESSAGE);

/** Response body for a successful call. */
interface TrendingResponseBody {
  items: VideoSummary[];
  /** Region actually used, uppercased. */
  regionCode: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  let regionCode = DEFAULT_REGION_CODE;

  try {
    const searchParams = new URL(request.url).searchParams;
    regionCode = resolveRegionCode(searchParams.get("region"));
    const maxResults = resolveMaxResults(searchParams.get("maxResults"));

    const items = await getTrending({ regionCode, maxResults });

    const body: TrendingResponseBody = { items, regionCode };
    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    return toErrorResponse(error, regionCode);
  }
}

/**
 * Explicit `?region=` wins when it is a two-letter code. Otherwise the optional
 * `YOUTUBE_REGION` default applies, and `US` is the last resort.
 *
 * @throws {DomainValidationError} when an explicit region is malformed.
 */
function resolveRegionCode(raw: string | null): string {
  if (raw !== null) {
    if (!REGION_PATTERN.test(raw)) {
      throw new DomainValidationError(
        "invalid_format",
        "Region must be a two-letter country code, for example US or GB.",
        { field: "region" },
      );
    }

    return raw.toUpperCase();
  }

  return resolveEnvRegion() ?? DEFAULT_REGION_CODE;
}

/** Reads `YOUTUBE_REGION` at request time; an invalid value is ignored, not thrown. */
function resolveEnvRegion(): string | null {
  const configured = (process.env[REGION_ENV_VAR] ?? "").trim();
  return REGION_PATTERN.test(configured) ? configured.toUpperCase() : null;
}

/**
 * Parses `?maxResults=` strictly: an absent parameter means "client default",
 * anything else must be a whole number from 1 to 50.
 *
 * @throws {DomainValidationError} for non-numeric, fractional or out-of-range input.
 */
function resolveMaxResults(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined;
  }

  const value = DIGITS_PATTERN.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < MIN_MAX_RESULTS || value > MAX_MAX_RESULTS) {
    throw new DomainValidationError(
      "invalid_format",
      `maxResults must be an integer from ${MIN_MAX_RESULTS} to ${MAX_MAX_RESULTS}.`,
      { field: "maxResults" },
    );
  }

  return value;
}

/**
 * Maps a thrown value to the shared envelope.
 *
 * - `DomainValidationError` from request parsing -> 400 with its authored message
 *   and field (never raw input). The one exception is `malformed_payload`, which
 *   means an upstream body failed normalization -> 502 UPSTREAM_ERROR.
 * - `YouTubeApiError` -> the table above; upstream text is replaced with generic copy.
 * - anything else -> 500 INTERNAL_ERROR, or 500 CONFIGURATION_ERROR for a missing key.
 *
 * The caller-supplied region is a two-letter code, so it is safe as log detail;
 * the API key and outbound URL are never passed to the logger.
 */
function toErrorResponse(error: unknown, regionCode: string): NextResponse<ApiErrorBody> {
  if (isDomainValidationError(error)) {
    if (error.code === "malformed_payload") {
      logServerError(error, {
        scope: LOG_SCOPE,
        details: { validationCode: error.code, regionCode },
      });

      return jsonErrorResult(MALFORMED_PAYLOAD_RESULT);
    }

    return jsonError(error);
  }

  if (isYouTubeApiError(error)) {
    logServerError(error, {
      scope: LOG_SCOPE,
      details: {
        youtubeCode: error.code,
        status: error.status,
        regionCode,
      },
    });

    return jsonErrorResult(YOUTUBE_FAILURE_RESULTS[error.code]);
  }

  logServerError(error, LOG_SCOPE);
  return jsonError(error);
}
