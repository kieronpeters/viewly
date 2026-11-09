/**
 * Client-safe display snapshot shared by the saved-video features (T33/T34).
 *
 * Favourites and watch later store exactly the same projection of a video, so
 * the shape and its validation live here rather than being duplicated per
 * feature. Like `favourite-toggle.ts`, this module has **no runtime dependency**
 * on the database layer, so a Client Component may import it without pulling
 * `better-sqlite3` (or the `server-only` guard) into the browser bundle.
 *
 * ## Trust boundary
 *
 * The caller supplies the display snapshot (`title`, `channelTitle`,
 * `thumbnailUrl`, `durationSeconds`) together with the video id. Server Actions
 * are reachable by direct POST, so {@link parseVideoSnapshot} re-validates the
 * shape before anything reaches SQLite. There is no board or user concept to
 * validate: Viewly is a single-user local app and every mutation writes to the
 * one local database.
 */
import type { VideoSummary } from "@/shared/types";
import { DomainValidationError, assertVideoId, isRecord } from "@/shared/validation";

/** Video titles hover around 100 characters; the extra headroom is deliberate. */
const MAX_TITLE_LENGTH = 500;

/** Channel names are shorter than titles, so a tighter bound is fine. */
const MAX_CHANNEL_TITLE_LENGTH = 200;

/** Long enough for a signed CDN thumbnail URL, short enough to reject a body. */
const MAX_THUMBNAIL_URL_LENGTH = 2_048;

/**
 * The display snapshot a saved video stores.
 *
 * Mirrors `VideoSnapshot` in the library repository, but is declared here so the
 * client can name the shape without importing a server-only module.
 */
export interface VideoSnapshot {
  /** YouTube video id, exactly 11 characters from `[A-Za-z0-9_-]`. */
  videoId: string;
  title: string;
  /** May be empty when the source did not provide a channel name. */
  channelTitle: string;
  /** Absolute `https` URL. */
  thumbnailUrl: string;
  /** Whole seconds, or `null` for live streams and missing details. */
  durationSeconds: number | null;
}

/**
 * Projects a normalized video into the snapshot the library stores.
 *
 * `VideoSummary` carries fields the library does not persist (`channelId`,
 * `publishedAt`, `viewCount`); dropping them here keeps the action input small
 * and makes the serialized payload explicit.
 */
export function videoSnapshotFromVideo(video: VideoSummary): VideoSnapshot {
  return {
    videoId: video.id,
    title: video.title,
    channelTitle: video.channelTitle,
    thumbnailUrl: video.thumbnailUrl,
    durationSeconds: video.durationSeconds,
  };
}

/**
 * Validates and normalizes an untrusted snapshot.
 *
 * Throws a `DomainValidationError` with a stable `field`, so a future UI can map
 * a failure to the offending control. Text is trimmed; durations are floored to
 * whole seconds because the schema stores an integer and SQLite would otherwise
 * keep a float in that column.
 */
export function parseVideoSnapshot(input: unknown): VideoSnapshot {
  if (!isRecord(input)) {
    throw new DomainValidationError(
      "malformed_payload",
      "A saved video must be an object with a video snapshot.",
    );
  }

  return {
    videoId: assertVideoId(input.videoId),
    title: requireText(input.title, "title", MAX_TITLE_LENGTH),
    channelTitle: optionalText(input.channelTitle, "channelTitle", MAX_CHANNEL_TITLE_LENGTH),
    thumbnailUrl: requireThumbnailUrl(input.thumbnailUrl),
    durationSeconds: optionalDurationSeconds(input.durationSeconds),
  };
}

/** Trimmed, non-empty text of at most `maxLength` code points. */
function requireText(value: unknown, field: string, maxLength: number): string {
  const text = readText(value, field, maxLength);

  if (text.length === 0) {
    throw new DomainValidationError("empty_value", `${field} must not be empty.`, { field });
  }

  return text;
}

/** Trimmed text that may normalize to the empty string (channel titles). */
function optionalText(value: unknown, field: string, maxLength: number): string {
  return readText(value, field, maxLength);
}

/**
 * Shared string check. Length is counted in code points, matching
 * `shared/validation.ts`, so a title of 500 emoji is still 500 characters.
 */
function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new DomainValidationError("invalid_type", `${field} must be a string.`, { field });
  }

  const trimmed = value.trim();

  if (Array.from(trimmed).length > maxLength) {
    throw new DomainValidationError(
      "too_long",
      `${field} must be at most ${maxLength} characters.`,
      { field },
    );
  }

  return trimmed;
}

/**
 * Absolute `https` URL, returned exactly as supplied (no normalization) so the
 * stored snapshot matches what the page rendered.
 */
function requireThumbnailUrl(value: unknown): string {
  const raw = requireText(value, "thumbnailUrl", MAX_THUMBNAIL_URL_LENGTH);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainValidationError("invalid_format", "thumbnailUrl must be a valid URL.", {
      field: "thumbnailUrl",
    });
  }

  if (url.protocol !== "https:") {
    throw new DomainValidationError("invalid_format", "thumbnailUrl must use https.", {
      field: "thumbnailUrl",
    });
  }

  return raw;
}

/** `null` is valid (live streams); anything else must be a finite, non-negative number. */
function optionalDurationSeconds(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(
      "invalid_format",
      "durationSeconds must be null or a non-negative number.",
      { field: "durationSeconds" },
    );
  }

  return Math.floor(value);
}
