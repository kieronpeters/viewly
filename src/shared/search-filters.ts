/**
 * Search filter vocabulary shared by the YouTube client, the API route, the
 * search page and the client-side controls (T88).
 *
 * Filter values are a closed set of short, URL-safe identifiers. They are
 * validated at every trust boundary (route, page component, client options) with
 * the same functions, so the URL, the upstream query string and the cache key
 * can never disagree about what a filter means.
 *
 * `any`, `relevance` and `any` are the defaults for duration, order and upload
 * date respectively. A default value is never sent upstream and never appears in
 * a canonical URL: an absent parameter already means "no filter".
 */

import { DomainValidationError } from "./validation";

/** Duration buckets accepted by `search.list` as `videoDuration`. */
export const SEARCH_DURATION_VALUES = ["any", "short", "medium", "long"] as const;

/** Sort orders accepted by `search.list` as `order`; the API's other orders are not exposed. */
export const SEARCH_ORDER_VALUES = ["relevance", "date", "viewCount"] as const;

/** Upload-date windows resolved to an ISO-8601 `publishedAfter` timestamp. */
export const SEARCH_UPLOAD_DATE_VALUES = ["any", "day", "week", "month"] as const;

export type SearchDuration = (typeof SEARCH_DURATION_VALUES)[number];
export type SearchOrder = (typeof SEARCH_ORDER_VALUES)[number];
export type SearchUploadDate = (typeof SEARCH_UPLOAD_DATE_VALUES)[number];

export const DEFAULT_SEARCH_DURATION: SearchDuration = "any";
export const DEFAULT_SEARCH_ORDER: SearchOrder = "relevance";
export const DEFAULT_SEARCH_UPLOAD_DATE: SearchUploadDate = "any";

/** The three independent filters a search can carry. */
export interface SearchFilters {
  duration: SearchDuration;
  order: SearchOrder;
  uploadDate: SearchUploadDate;
}

/** Defaults for a search with no filters, used when a parameter is absent. */
export const DEFAULT_SEARCH_FILTERS: Readonly<SearchFilters> = {
  duration: DEFAULT_SEARCH_DURATION,
  order: DEFAULT_SEARCH_ORDER,
  uploadDate: DEFAULT_SEARCH_UPLOAD_DATE,
};

/**
 * Window subtracted from "now" for each non-default upload date.
 *
 * A month is 30 days: YouTube's `publishedAfter` is an exact timestamp, so the
 * UI copy says "Last 30 days" rather than promising a calendar month.
 */
export const SEARCH_UPLOAD_WINDOW_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
} as const satisfies Record<Exclude<SearchUploadDate, "any">, number>;

/** Input shape accepted by {@link resolveSearchFilters}. */
export interface SearchFilterInput {
  duration?: unknown;
  order?: unknown;
  uploadDate?: unknown;
}

/**
 * Validates and normalizes all three filters.
 *
 * Absent values (`null`, `undefined`, an empty or whitespace-only string)
 * resolve to their defaults. Anything else must be one of the enumerated
 * values; a typo, a stale bookmark or an unknown value throws a
 * `DomainValidationError` whose `field` names the offending parameter, so the
 * route can answer 400 and the page can explain which control is wrong.
 */
export function resolveSearchFilters(input: SearchFilterInput): SearchFilters {
  return {
    duration: assertSearchDuration(input.duration),
    order: assertSearchOrder(input.order),
    uploadDate: assertSearchUploadDate(input.uploadDate),
  };
}

/** Duration guard: `any | short | medium | long`; absent means `any`. */
export function assertSearchDuration(value: unknown): SearchDuration {
  return assertFilterValue(
    value,
    SEARCH_DURATION_VALUES,
    "duration",
    DEFAULT_SEARCH_DURATION,
    "Duration must be one of: any, short, medium, long.",
  );
}

/** Order guard: `relevance | date | viewCount`; absent means `relevance`. */
export function assertSearchOrder(value: unknown): SearchOrder {
  return assertFilterValue(
    value,
    SEARCH_ORDER_VALUES,
    "order",
    DEFAULT_SEARCH_ORDER,
    "Order must be one of: relevance, date, viewCount.",
  );
}

/** Upload-date guard: `any | day | week | month`; absent means `any`. */
export function assertSearchUploadDate(value: unknown): SearchUploadDate {
  return assertFilterValue(
    value,
    SEARCH_UPLOAD_DATE_VALUES,
    "uploadDate",
    DEFAULT_SEARCH_UPLOAD_DATE,
    "Upload date must be one of: any, day, week, month.",
  );
}

/**
 * Only the filters that differ from their defaults.
 *
 * Used to keep canonical URLs, route calls and upstream query strings free of
 * redundant `duration=any&order=relevance&uploadDate=any` noise. The client
 * treats an absent option exactly like the default value.
 */
export function nonDefaultSearchFilters(filters: SearchFilters): Partial<SearchFilters> {
  const changed: Partial<SearchFilters> = {};

  if (filters.duration !== DEFAULT_SEARCH_DURATION) {
    changed.duration = filters.duration;
  }

  if (filters.order !== DEFAULT_SEARCH_ORDER) {
    changed.order = filters.order;
  }

  if (filters.uploadDate !== DEFAULT_SEARCH_UPLOAD_DATE) {
    changed.uploadDate = filters.uploadDate;
  }

  return changed;
}

/**
 * Resolves an upload-date window to the `publishedAfter` value `search.list`
 * expects, or null when no date filter is active.
 *
 * `nowMs` is injectable so callers and tests can pin the clock. The returned
 * timestamp is exact, not rounded: the YouTube client's cache key normalizes
 * `publishedAfter` to the minute, which keeps repeated filtered searches on one
 * cache entry without changing the upstream request.
 *
 * The clock is read only after the `any` early return. A default parameter
 * (`nowMs = Date.now()`) would evaluate even for `any`, which makes the home
 * page's default recommendation call touch the current time during prerender.
 * Next rejects that (`blocking-prerender-current-time`), so the fallback is
 * lazy: no filter means no clock read.
 */
export function searchPublishedAfter(uploadDate: SearchUploadDate, nowMs?: number): string | null {
  if (uploadDate === "any") {
    return null;
  }

  return new Date((nowMs ?? Date.now()) - SEARCH_UPLOAD_WINDOW_MS[uploadDate]).toISOString();
}

function assertFilterValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback: T,
  message: string,
): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new DomainValidationError("invalid_type", message, { field });
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return fallback;
  }

  const match = allowed.find((candidate) => candidate === trimmed);
  if (match === undefined) {
    throw new DomainValidationError("invalid_format", message, { field });
  }

  return match;
}
