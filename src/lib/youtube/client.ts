/**
 * Server-only YouTube Data API v3 client.
 *
 * Every request goes through `fetch` against `https://www.googleapis.com/youtube/v3`
 * with an 8 second `AbortSignal.timeout`. The API key is read lazily through
 * `getYoutubeApiKey()` for each logical call and is only ever written to the
 * outbound request URL: it is never logged, never attached to a returned object
 * and never interpolated into an error message or its cause. Errors carry a
 * stable `code` plus the HTTP `status` and YouTube `reason` instead, so callers
 * can branch without ever seeing the request URL.
 *
 * Responses are normalized by `src/shared/youtube.ts` before leaving this module;
 * this client never returns raw API payloads.
 *
 * ## List vs detail shape (T13)
 *
 * `videos.list` has a single normalizer, `normalizeVideoResponse`, which produces
 * a `VideoDetail`. The list endpoints (`getVideos`, `getTrending`) reuse it and
 * then project the result onto `VideoSummary` with `toVideoSummary`, so a list
 * item never carries a `description` own property at runtime. Only `getVideo`
 * returns `VideoDetail`, and it keeps the description.
 *
 * ## Caching (T18)
 *
 * Each logical call is wrapped in the process-local cache in `./cache`: the
 * public signatures are unchanged, and a cache hit returns before the API key is
 * even read. Entries are keyed by endpoint plus normalized parameters (never by
 * key material), bounded at 200 entries with LRU eviction, and expired by TTL:
 * search 60 s, video details 10 min, trending 5 min, categories 24 h, comments
 * 5 min. Concurrent identical calls share one upstream request.
 *
 * The cached value is the **normalized domain object**, not the raw payload:
 * fetching and normalization both run inside the cached loader, so a 200
 * response whose body fails normalization is never stored. Only fulfilled
 * loads are cached; errors — transport, HTTP and normalization alike — are
 * always propagated and immediately forgotten, and the next call re-fetches.
 * `YOUTUBE_CACHE_DISABLED=1` bypasses the cache entirely for debugging, and
 * `clearYouTubeCache()` empties it (tests and manual debugging).
 *
 * ## Quota cost and daily budget
 *
 * Costs below were read from the official quota page on 2026-11-10:
 * <https://developers.google.com/youtube/v3/determine_quota_cost>. Do not copy
 * older figures: `search.list` is no longer billed as 100 units from the shared
 * pool. It has its own bucket of **100 calls per day**, and each call costs one
 * unit of that bucket. `videos.list` and `videoCategories.list` cost **1 unit**
 * each from the shared **10,000 units/day** pool. `videos.insert` (unused by
 * Viewly) has a separate 100/day bucket.
 *
 * | Client call            | Endpoint              | Cost per request                 |
 * | ---------------------- | --------------------- | -------------------------------- |
 * | `searchVideos`         | `search.list`         | 1 of 100 search calls/day        |
 * | `getVideo`             | `videos.list`         | 1 of 10,000 units/day            |
 * | `getVideos`            | `videos.list`         | 1 unit per 50 ids (batch)        |
 * | `getTrending`          | `videos.list` (chart) | 1 of 10,000 units/day            |
 * | `listVideoCategories`  | `videoCategories.list`| 1 of 10,000 units/day            |
 * | `listComments`         | `commentThreads.list` | 1 of 10,000 units/day            |
 *
 * Every retry of a 429/5xx response and every extra results page is another
 * billable call, which is why the cache exists. Budget picture for one local
 * user: 100 searches per day (search only) and 10,000 units/day for details,
 * trending and categories combined. A day of ordinary browsing — say 20
 * searches, 200 detail views and 50 trending loads — costs 20 search calls plus
 * 250 units, leaving most of both budgets untouched. Quota resets at midnight
 * Pacific Time. Exceeding it is a policy violation (ToS §15), so the cache is a
 * correctness control, not just a performance one.
 *
 * Live smoke check: PENDING. A real request against the YouTube Data API needs an
 * owner-supplied `YOUTUBE_API_KEY`, which is not available in this workspace, so
 * the live path has not been exercised. Unit tests stub `fetch` and cover the
 * request shape, error mapping, caching and coalescing only.
 */

import "server-only";

import { getYoutubeApiKey } from "@/lib/env";
import {
  type SearchDuration,
  type SearchOrder,
  type SearchUploadDate,
  nonDefaultSearchFilters,
  resolveSearchFilters,
  searchPublishedAfter,
} from "@/shared/search-filters";
import type { CommentPage, SearchPage, VideoDetail, VideoSummary } from "@/shared/types";
import {
  DomainValidationError,
  assertPageToken,
  assertSearchQuery,
  assertVideoId,
  isRecord,
} from "@/shared/validation";
import {
  normalizeCommentThreadsResponse,
  normalizeSearchResponse,
  normalizeVideoResponse,
} from "@/shared/youtube";

import {
  type Cache,
  YOUTUBE_CACHE_TTLS_MS,
  buildRequestCacheKey,
  createTtlCache,
  isYouTubeCacheDisabled,
} from "./cache";

/** Base URL for the YouTube Data API v3. */
const API_BASE_URL = "https://www.googleapis.com/youtube/v3";

/** Upper bound on `maxResults` accepted by `search.list` and `videos.list`. */
export const MAX_RESULTS_LIMIT = 50;

/** `commentThreads.list` accepts up to 100 threads per request. */
export const MAX_COMMENT_RESULTS_LIMIT = 100;

/** Default page size when the caller does not choose one. */
const DEFAULT_MAX_RESULTS = 25;

/** Comment pages are smaller by default: one page is already a long column. */
const DEFAULT_COMMENT_MAX_RESULTS = 20;

/** `videos.list` accepts at most 50 ids per request. */
const IDS_PER_REQUEST = 50;

/** Hard per-request deadline, applied with `AbortSignal.timeout`. */
const REQUEST_TIMEOUT_MS = 8000;

/** Short pause before the single allowed retry of a 429/5xx response. */
const RETRY_DELAY_MS = 200;

/** Parts required for `VideoSummary` / `VideoDetail` normalization. */
const VIDEO_PARTS = "snippet,contentDetails,statistics";

/** Fallback region when the caller does not supply one (ISO 3166-1 alpha-2). */
const DEFAULT_REGION_CODE = "US";

/** ISO 3166-1 alpha-2 country code. */
const REGION_CODE_PATTERN = /^[A-Za-z]{2}$/;

/** YouTube reasons are short enumerated identifiers, not free-form text. */
const SAFE_REASON_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Process-wide request cache. One instance per server process; bounded by
 * `DEFAULT_MAX_ENTRIES` (200) with LRU eviction, so it can never grow without
 * limit. Holds normalized domain values only, for their TTL (60 s to 24 h).
 */
const requestCache: Cache = createTtlCache();

/**
 * Empties the request cache. Test and debugging helper only: production code
 * has no reason to flush it. In-flight loads that finish afterwards will still
 * populate their entry.
 */
export function clearYouTubeCache(): void {
  requestCache.clear();
}

/** Stable, machine-readable failure codes. Callers may branch on these. */
export type YouTubeApiErrorCode =
  "quota" | "auth" | "bad_request" | "not_found" | "upstream" | "network" | "timeout";

/** Authored copy per code. Never interpolates the request URL or the API key. */
const ERROR_MESSAGES: Record<YouTubeApiErrorCode, string> = {
  quota: "The YouTube API quota has been exceeded.",
  auth: "YouTube rejected the API credentials.",
  bad_request: "YouTube rejected the request.",
  not_found: "The requested YouTube resource was not found.",
  upstream: "YouTube returned an unexpected response.",
  network: "Could not reach the YouTube API.",
  timeout: "The YouTube API request timed out.",
};

/**
 * Typed failure raised by this client.
 *
 * `status` is the HTTP status when there was a response, otherwise null.
 * `reason` is the first safe YouTube error reason (for example `quotaExceeded`),
 * otherwise null. Neither field can contain the request URL or the API key.
 */
export class YouTubeApiError extends Error {
  readonly code: YouTubeApiErrorCode;
  readonly status: number | null;
  readonly reason: string | null;

  constructor(
    code: YouTubeApiErrorCode,
    message: string,
    options: { status?: number | null; reason?: string | null } = {},
  ) {
    super(message);
    this.name = "YouTubeApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.reason = options.reason ?? null;
  }
}

/** Narrowing helper so callers do not need `instanceof` checks inline. */
export function isYouTubeApiError(value: unknown): value is YouTubeApiError {
  return value instanceof YouTubeApiError;
}

export interface SearchVideosOptions {
  /** User search terms, validated with `assertSearchQuery`. */
  query: string;
  /** Continuation token from a previous `SearchPage`, or null for the first page. */
  pageToken?: string | null;
  /** Requested page size; clamped to 1..50. */
  maxResults?: number;
  /**
   * Duration bucket, sent as `videoDuration`. Defaults to `any`, which omits the
   * parameter. Validated with `assertSearchDuration`.
   */
  duration?: SearchDuration;
  /**
   * Result order, sent as `order`. Defaults to `relevance`, which omits the
   * parameter. Validated with `assertSearchOrder`.
   */
  order?: SearchOrder;
  /**
   * Upload-date window, resolved to `publishedAfter`. Defaults to `any`, which
   * omits the parameter. Validated with `assertSearchUploadDate`.
   */
  uploadDate?: SearchUploadDate;
}

export interface TrendingOptions {
  /** ISO 3166-1 alpha-2 region code; defaults to `US`. */
  regionCode?: string;
  /** Requested page size; clamped to 1..50. */
  maxResults?: number;
}

export interface ListCommentsOptions {
  /** Video whose top-level comment threads should be listed. */
  videoId: string;
  /** Continuation token from a previous `CommentPage`, or null for the first page. */
  pageToken?: string | null;
  /** Requested page size; clamped to 1..100. Defaults to 20. */
  maxResults?: number;
}

/** Minimal category shape used by filters; never the raw API payload. */
export interface VideoCategory {
  id: string;
  title: string;
  /** Whether videos can be assigned to this category. */
  assignable: boolean;
}

/**
 * Runs `search.list` for videos and normalizes the response.
 *
 * Non-video items (channels, playlists) are dropped by the normalizer.
 *
 * @throws {DomainValidationError} for an invalid query, page token or region.
 * @throws {YouTubeApiError} for transport, HTTP and payload failures.
 */
export async function searchVideos(options: SearchVideosOptions): Promise<SearchPage> {
  const query = assertSearchQuery(options.query);
  const pageToken = assertPageToken(options.pageToken ?? null);
  const maxResults = clampMaxResults(options.maxResults);
  // Invalid filter values are rejected here, before any cache lookup or I/O.
  const filters = resolveSearchFilters(options);
  const activeFilters = nonDefaultSearchFilters(filters);
  const publishedAfter = searchPublishedAfter(filters.uploadDate);

  const params = {
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(maxResults),
    pageToken: pageToken ?? undefined,
    order: activeFilters.order,
    videoDuration: activeFilters.duration,
    publishedAfter: publishedAfter ?? undefined,
  };

  return cachedRequest("search", params, YOUTUBE_CACHE_TTLS_MS.search, async () =>
    normalizeSearchResponse(await fetchJson("search", params)),
  );
}

/**
 * Fetches one video with snippet, content details and statistics.
 * Returns null when YouTube has no usable item for the id (missing, private, deleted).
 *
 * @throws {DomainValidationError} when `id` is not a valid video id.
 * @throws {YouTubeApiError} for transport, HTTP and payload failures.
 */
export async function getVideo(id: string): Promise<VideoDetail | null> {
  const videoId = assertVideoId(id);

  const params = {
    part: VIDEO_PARTS,
    id: videoId,
  };

  return cachedRequest(
    "videos",
    params,
    YOUTUBE_CACHE_TTLS_MS.videoDetails,
    async () => normalizeVideoResponse(await fetchJson("videos", params)),
    "videos:detail",
  );
}

/**
 * Fetches many videos, batching at most 50 ids per request.
 *
 * Every id is validated before the first request, so a bad id never reaches the
 * network. Duplicate ids are requested once and returned in first-seen order;
 * ids YouTube does not return are omitted.
 *
 * @throws {DomainValidationError} when any id is not a valid video id.
 * @throws {YouTubeApiError} for transport, HTTP and payload failures.
 */
export async function getVideos(ids: readonly string[]): Promise<VideoSummary[]> {
  // Validate the whole input up front: fail before any request is made.
  const videoIds = ids.map((id) => assertVideoId(id));
  const uniqueIds = [...new Set(videoIds)];

  if (uniqueIds.length === 0) {
    return [];
  }

  const byId = new Map<string, VideoSummary>();
  for (const batch of chunk(uniqueIds, IDS_PER_REQUEST)) {
    const params = {
      part: VIDEO_PARTS,
      id: batch.join(","),
    };

    const summaries = await cachedRequest(
      "videos",
      params,
      YOUTUBE_CACHE_TTLS_MS.videoDetails,
      async () => normalizeVideoList(await fetchJson("videos", params)),
      "videos:list",
    );

    for (const summary of summaries) {
      byId.set(summary.id, summary);
    }
  }

  const result: VideoSummary[] = [];
  for (const id of uniqueIds) {
    const summary = byId.get(id);
    if (summary !== undefined) {
      result.push(summary);
    }
  }

  return result;
}

/**
 * Lists assignable video categories for a region, or all categories when none is given.
 *
 * @throws {DomainValidationError} for an invalid region code or a malformed payload.
 * @throws {YouTubeApiError} for transport and HTTP failures.
 */
export async function listVideoCategories(regionCode?: string): Promise<VideoCategory[]> {
  const region = regionCode === undefined ? DEFAULT_REGION_CODE : assertRegionCode(regionCode);

  const params = {
    part: "snippet",
    regionCode: region,
  };

  return cachedRequest("videoCategories", params, YOUTUBE_CACHE_TTLS_MS.categories, async () =>
    normalizeCategoryList(await fetchJson("videoCategories", params)),
  );
}

/**
 * Fetches the most popular videos for a region.
 *
 * @throws {DomainValidationError} for an invalid region code or a malformed payload.
 * @throws {YouTubeApiError} for transport and HTTP failures.
 */
export async function getTrending(options: TrendingOptions = {}): Promise<VideoSummary[]> {
  const regionCode =
    options.regionCode === undefined ? DEFAULT_REGION_CODE : assertRegionCode(options.regionCode);
  const maxResults = clampMaxResults(options.maxResults);

  const params = {
    part: VIDEO_PARTS,
    chart: "mostPopular",
    regionCode,
    maxResults: String(maxResults),
  };

  return cachedRequest("videos", params, YOUTUBE_CACHE_TTLS_MS.trending, async () =>
    normalizeVideoList(await fetchJson("videos", params)),
  );
}

/**
 * Lists top-level comment threads for a video, most relevant first.
 *
 * Disabled comments are a normal state, not a failure: YouTube answers
 * `commentThreads.list` with a 403 `commentsDisabled` reason, which becomes an
 * empty `CommentPage` with `commentsDisabled: true`. That page is cached like
 * any other result, so a disabled video does not spend quota on every view.
 * Quota, auth, transport and malformed-payload failures still throw.
 *
 * The cached value is the normalized page. Comment text lives only in this
 * five-minute in-memory entry; it is never persisted or logged.
 *
 * @throws {DomainValidationError} for an invalid video id, page token or payload.
 * @throws {YouTubeApiError} for transport, HTTP and quota failures.
 */
export async function listComments(options: ListCommentsOptions): Promise<CommentPage> {
  const videoId = assertVideoId(options.videoId);
  const pageToken = assertPageToken(options.pageToken ?? null);
  const maxResults = clampMaxResults(
    options.maxResults,
    MAX_COMMENT_RESULTS_LIMIT,
    DEFAULT_COMMENT_MAX_RESULTS,
  );

  const params = {
    part: "snippet",
    videoId,
    order: "relevance",
    maxResults: String(maxResults),
    pageToken: pageToken ?? undefined,
  };

  return cachedRequest("commentThreads", params, YOUTUBE_CACHE_TTLS_MS.comments, async () => {
    try {
      return normalizeCommentThreadsResponse(await fetchJson("commentThreads", params));
    } catch (error) {
      // The channel turned comments off. `fetchJson` maps the 403 to the shared
      // bad_request code but keeps YouTube's stable reason, so it is still
      // distinguishable here without widening the error-code union.
      if (
        isYouTubeApiError(error) &&
        error.code === "bad_request" &&
        error.reason === "commentsDisabled"
      ) {
        return { items: [], nextPageToken: null, commentsDisabled: true };
      }

      throw error;
    }
  });
}

/**
 * Runs one logical API call through the cache and returns its **normalized**
 * value. `load` must perform both the fetch and the normalization, so only a
 * result that survived normalization can ever be stored: a payload that throws
 * `DomainValidationError` leaves no entry behind and the next call re-fetches.
 *
 * The cache key is derived from `keyScope` and `params` only, before the API key
 * is read, so key material can never enter a cache key or a stored value. A hit
 * never touches `getYoutubeApiKey()`, because `load` only runs on a miss. When
 * `YOUTUBE_CACHE_DISABLED` is set, or the TTL is non-positive, the call goes
 * straight to the network with no read, no write and no coalescing.
 *
 * `keyScope` defaults to `endpoint` and exists because two callers can share the
 * same request parameters while caching differently shaped values (`getVideo`
 * stores one detail, `getVideos` stores a list). Those must not share an entry.
 *
 * @throws {EnvConfigurationError} on a miss when no API key is configured.
 * @throws {YouTubeApiError} for transport and HTTP failures.
 * @throws {DomainValidationError} when the payload fails normalization.
 */
async function cachedRequest<T>(
  endpoint: string,
  params: Record<string, string | undefined>,
  ttlMs: number,
  load: () => Promise<T>,
  keyScope: string = endpoint,
): Promise<T> {
  if (ttlMs <= 0 || isYouTubeCacheDisabled()) {
    return load();
  }

  const cacheKey = buildRequestCacheKey(keyScope, params);
  return requestCache.getOrLoad(cacheKey, ttlMs, load);
}

/**
 * Performs one logical API call: reads the key, builds the URL and runs the
 * request. A 429 or 5xx response is retried exactly once after a short delay.
 */
async function fetchJson(
  endpoint: string,
  params: Record<string, string | undefined>,
): Promise<unknown> {
  // Lazy read: a missing key fails here, not at module load, and never leaves this module.
  const key = getYoutubeApiKey();
  const url = buildUrl(endpoint, params, key);

  for (let attempt = 0; ; attempt += 1) {
    const response = await send(url);

    if (response.ok) {
      return await readJson(response);
    }

    const reason = extractReason(await readJsonOrNull(response));
    const retryable = response.status === 429 || response.status >= 500;

    if (retryable && attempt === 0) {
      await delay(RETRY_DELAY_MS);
      continue;
    }

    throw createApiError(mapHttpStatus(response.status, reason), response.status, reason);
  }
}

/** Builds the outbound URL. The key is added last and only to this URL. */
function buildUrl(endpoint: string, params: Record<string, string | undefined>, key: string): URL {
  const url = new URL(`${API_BASE_URL}/${endpoint}`);

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }

  url.searchParams.set("key", key);
  return url;
}

/**
 * Sends the request with a fresh 8 second deadline. Transport failures are
 * converted to typed errors here; the original fetch error is intentionally
 * discarded because its message can contain the request URL (and therefore the key).
 */
async function send(url: URL): Promise<Response> {
  try {
    return await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLike(error)) {
      throw createApiError("timeout", null, null);
    }

    throw createApiError("network", null, null);
  }
}

/** Parses a successful body; a malformed body is an upstream failure, not a network one. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isAbortLike(error)) {
      throw createApiError("timeout", null, null);
    }

    throw createApiError("upstream", response.status, null);
  }
}

/** Reads an error body for its YouTube reason. Never throws. */
async function readJsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Maps an HTTP status plus YouTube reason to a stable code:
 *
 * | Condition                     | Code        |
 * | ----------------------------- | ----------- |
 * | 403, reason quotaExceeded      | quota       |
 * | 400 or 403, reason keyInvalid  | auth        |
 * | 404                            | not_found   |
 * | 5xx                            | upstream    |
 * | any other 4xx (including 429)  | bad_request |
 */
function mapHttpStatus(status: number, reason: string | null): YouTubeApiErrorCode {
  if (status === 404) {
    return "not_found";
  }

  if (status >= 500) {
    return "upstream";
  }

  if (status === 403 && reason === "quotaExceeded") {
    return "quota";
  }

  if ((status === 400 || status === 403) && reason === "keyInvalid") {
    return "auth";
  }

  return "bad_request";
}

/** Extracts the first safe `reason` from a YouTube error envelope. */
function extractReason(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  const candidates = payload.error.errors;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (isRecord(candidate) && isSafeReason(candidate.reason)) {
        return candidate.reason;
      }
    }
  }

  return null;
}

function isSafeReason(value: unknown): value is string {
  return typeof value === "string" && SAFE_REASON_PATTERN.test(value);
}

/** Builds a typed error. `status` and `reason` are safe; the URL is never passed in. */
function createApiError(
  code: YouTubeApiErrorCode,
  status: number | null,
  reason: string | null,
): YouTubeApiError {
  const statusText = status === null ? "" : ` (HTTP ${status})`;
  const reasonText = reason === null ? "" : `, reason: ${reason}`;

  return new YouTubeApiError(code, `${ERROR_MESSAGES[code]}${statusText}${reasonText}.`, {
    status,
    reason,
  });
}

/**
 * Normalizes a `videos.list` payload into summaries.
 *
 * The committed normalizer returns a single video, so each item is normalized in
 * isolation and unusable items are dropped. `toVideoSummary` then drops the
 * detail-only `description`, so list endpoints return true `VideoSummary`
 * objects rather than `VideoDetail` values narrowed by their declared type.
 */
function normalizeVideoList(payload: unknown): VideoSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw malformedPayload("Video response must contain an items array.");
  }

  const summaries: VideoSummary[] = [];
  for (const item of payload.items) {
    const detail = normalizeVideoResponse({ items: [item] });
    if (detail !== null) {
      summaries.push(toVideoSummary(detail));
    }
  }

  return summaries;
}

/**
 * Projects a normalized `VideoDetail` onto the `VideoSummary` contract.
 *
 * This is the one place the detail-only field is removed: it keeps a single
 * normalisation path (`normalizeVideoResponse`) instead of duplicating the
 * summary rules here. The returned object has no `description` own property, so
 * a serialized list never includes descriptions that the contract does not
 * declare.
 */
function toVideoSummary(detail: VideoDetail): VideoSummary {
  // Copy, then remove the detail-only field so no `description` own property
  // survives. Deleting from the copy keeps the cached detail (if any) intact.
  const summary: VideoSummary & { description?: string } = { ...detail };
  delete summary.description;
  return summary;
}

/**
 * Normalizes a `videoCategories.list` payload into categories, dropping entries
 * without a usable id, snippet or title.
 */
function normalizeCategoryList(payload: unknown): VideoCategory[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw malformedPayload("Video category response must contain an items array.");
  }

  const categories: VideoCategory[] = [];
  for (const item of payload.items) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) {
      continue;
    }

    if (!isRecord(item.snippet)) {
      continue;
    }

    const title = typeof item.snippet.title === "string" ? item.snippet.title.trim() : "";
    if (title.length === 0) {
      continue;
    }

    categories.push({
      id: item.id,
      title,
      assignable: item.snippet.assignable === true,
    });
  }

  return categories;
}

/**
 * Clamps a requested page size to 1..`limit`, falling back to `fallback` for
 * absent or non-finite values. The bounds are per endpoint: search and videos
 * cap at 50, comment threads at 100.
 */
function clampMaxResults(
  value: number | undefined,
  limit: number = MAX_RESULTS_LIMIT,
  fallback: number = DEFAULT_MAX_RESULTS,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), 1), limit);
}

function assertRegionCode(value: string): string {
  if (!REGION_CODE_PATTERN.test(value)) {
    throw new DomainValidationError(
      "invalid_format",
      "Region code must be a two-letter ISO 3166-1 country code.",
      { field: "regionCode" },
    );
  }

  return value.toUpperCase();
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

/** AbortSignal.timeout aborts with a TimeoutError; older runtimes use AbortError. */
function isAbortLike(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function malformedPayload(message: string): DomainValidationError {
  return new DomainValidationError("malformed_payload", message);
}
