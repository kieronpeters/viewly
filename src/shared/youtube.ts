/**
 * Normalizers for YouTube Data API responses.
 *
 * Both entry points accept `unknown`, narrow with hand-written guards and return
 * domain objects from `./types`. Unknown fields are ignored, missing optional parts
 * (thumbnails, statistics, contentDetails) degrade gracefully, and structurally
 * broken payloads throw `DomainValidationError` instead of leaking into the UI.
 */

import type { SearchPage, VideoDetail, VideoSummary } from "./types";
import { DomainValidationError, assertPageToken, isRecord, isVideoId } from "./validation";

/** Largest title we are willing to render; real YouTube titles are far shorter. */
const MAX_TITLE_LENGTH = 300;

/** Preferred thumbnail variants, largest first. */
const THUMBNAIL_KEYS = ["maxres", "standard", "high", "medium", "default"] as const;

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const ISO_DURATION_PATTERN = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * Normalizes a `search.list` response into a `SearchPage`.
 *
 * Items that are not videos (channels, playlists), lack a usable id, title or
 * publish date are dropped rather than surfaced half-formed.
 *
 * @throws {DomainValidationError} when the payload itself is not a search response.
 */
export function normalizeSearchResponse(payload: unknown): SearchPage {
  if (!isRecord(payload)) {
    throw malformedPayload("Search response must be an object.");
  }

  const rawItems = payload.items;
  if (!Array.isArray(rawItems)) {
    throw malformedPayload("Search response must contain an items array.");
  }

  const items: VideoSummary[] = [];
  for (const rawItem of rawItems) {
    const summary = toVideoSummary(rawItem);
    if (summary !== null) {
      items.push(summary);
    }
  }

  return {
    items,
    nextPageToken: readNextPageToken(payload),
    totalResults: readNonNegativeInteger(readRecord(payload, "pageInfo"), "totalResults"),
  };
}

/**
 * Normalizes a `videos.list` response into a single `VideoDetail`.
 *
 * Returns null for a well-formed response that contains no usable video, which is
 * what the API returns for missing, private or deleted ids. Malformed payloads throw.
 *
 * @throws {DomainValidationError} when the payload itself is not a video response.
 */
export function normalizeVideoResponse(payload: unknown): VideoDetail | null {
  if (!isRecord(payload)) {
    throw malformedPayload("Video response must be an object.");
  }

  const rawItems = payload.items;
  if (!Array.isArray(rawItems)) {
    throw malformedPayload("Video response must contain an items array.");
  }

  for (const rawItem of rawItems) {
    const detail = toVideoDetail(rawItem);
    if (detail !== null) {
      return detail;
    }
  }

  return null;
}

/**
 * Parses an ISO-8601 duration such as "PT1H2M3S" into whole seconds.
 * Returns null for unparseable input; "P0D" (a YouTube live stream) parses to 0.
 */
export function parseIsoDuration(value: string): number | null {
  const match = ISO_DURATION_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, weeks, days, hours, minutes, seconds] = match;
  if (!weeks && !days && !hours && !minutes && !seconds) {
    return null;
  }

  // "P1DT" is structurally invalid: a T separator must be followed by a time part.
  if (value.includes("T") && !hours && !minutes && !seconds) {
    return null;
  }

  const totalSeconds =
    toNumber(weeks) * 604800 +
    toNumber(days) * 86400 +
    toNumber(hours) * 3600 +
    toNumber(minutes) * 60 +
    toNumber(seconds);

  return Number.isSafeInteger(totalSeconds) ? totalSeconds : null;
}

function toVideoSummary(rawItem: unknown): VideoSummary | null {
  if (!isRecord(rawItem)) {
    return null;
  }

  const id = readVideoId(rawItem.id);
  if (id === null) {
    return null;
  }

  const snippet = readRecord(rawItem, "snippet");
  if (snippet === null) {
    return null;
  }

  const title = readTitle(snippet);
  if (title === null) {
    return null;
  }

  const publishedAt = readIsoDate(snippet, "publishedAt");
  if (publishedAt === null) {
    return null;
  }

  return {
    id,
    title,
    channelId: readString(snippet, "channelId") ?? "",
    channelTitle: readString(snippet, "channelTitle") ?? "",
    thumbnailUrl: pickThumbnailUrl(snippet, id),
    publishedAt,
    durationSeconds: readDurationSeconds(rawItem),
    viewCount: readNonNegativeInteger(readRecord(rawItem, "statistics"), "viewCount"),
  };
}

function toVideoDetail(rawItem: unknown): VideoDetail | null {
  if (!isRecord(rawItem)) {
    return null;
  }

  const summary = toVideoSummary(rawItem);
  if (summary === null) {
    return null;
  }

  const snippet = readRecord(rawItem, "snippet");
  return {
    ...summary,
    description: readString(snippet, "description") ?? "",
  };
}

/** Video ids arrive as `{ videoId }` from search and as a plain string from videos. */
function readVideoId(value: unknown): string | null {
  if (typeof value === "string") {
    return isVideoId(value) ? value : null;
  }

  if (isRecord(value) && isVideoId(value.videoId)) {
    return value.videoId;
  }

  return null;
}

function readTitle(snippet: Record<string, unknown>): string | null {
  const value = readString(snippet, "title");
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
    return null;
  }

  return trimmed;
}

/**
 * Picks the largest available https thumbnail. Falls back to YouTube's public
 * thumbnail endpoint so `thumbnailUrl` is always a usable absolute URL.
 */
function pickThumbnailUrl(snippet: Record<string, unknown>, videoId: string): string {
  const thumbnails = readRecord(snippet, "thumbnails");

  if (thumbnails !== null) {
    for (const key of THUMBNAIL_KEYS) {
      const candidate = thumbnails[key];
      if (isRecord(candidate) && isHttpsUrl(candidate.url)) {
        return candidate.url;
      }
    }
  }

  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function readDurationSeconds(item: Record<string, unknown>): number | null {
  const duration = readString(readRecord(item, "contentDetails"), "duration");
  return duration === null ? null : parseIsoDuration(duration);
}

function readNextPageToken(payload: Record<string, unknown>): string | null {
  const value = payload.nextPageToken;
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw malformedPayload("Search response has a non-string nextPageToken.", "nextPageToken");
  }

  // Reuses the shared token rules: absent/empty tokens become null, hostile ones throw.
  return assertPageToken(value);
}

/** Reads an ISO-8601 timestamp, rejecting free-form dates and unparseable values. */
function readIsoDate(source: Record<string, unknown>, key: string): string | null {
  const value = readString(source, key);
  if (value === null || !ISO_DATE_TIME_PATTERN.test(value)) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) {
    return null;
  }

  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readRecord(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (source === null) {
    return null;
  }

  const value = source[key];
  return isRecord(value) ? value : null;
}

/** Accepts a non-negative integer given as a number or a decimal string. */
function readNonNegativeInteger(
  source: Record<string, unknown> | null,
  key: string,
): number | null {
  if (source === null) {
    return null;
  }

  const value = source[key];

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value === "string" && /^\d{1,15}$/.test(value)) {
    return Number(value);
  }

  return null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function toNumber(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}

function malformedPayload(message: string, field?: string): DomainValidationError {
  return new DomainValidationError("malformed_payload", message, { field });
}
