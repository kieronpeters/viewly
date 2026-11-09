/**
 * Runtime validation for values entering the app from outside the trust boundary:
 * search params, route params and request payloads.
 *
 * Every `assert*` function accepts `unknown`, narrows with a hand-written guard and
 * returns a normalized value, or throws a `DomainValidationError` with a stable code.
 * Raw strings are never thrown.
 */

export const VIDEO_ID_LENGTH = 11;
export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_PLAYLIST_NAME_LENGTH = 60;
export const MAX_PAGE_TOKEN_LENGTH = 512;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Base64url-ish alphabet used by YouTube page tokens, including "=" padding. */
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_\-=]+$/;

/** C0 and C1 control characters, including tab, line breaks and DEL. */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/** Stable, machine-readable failure codes. Callers may branch on these. */
export type DomainValidationCode =
  | "invalid_type"
  | "empty_value"
  | "too_long"
  | "control_characters"
  | "invalid_format"
  | "malformed_payload";

export class DomainValidationError extends Error {
  readonly code: DomainValidationCode;
  /** Logical field that failed validation, for mapping to a form error. */
  readonly field: string | null;

  constructor(
    code: DomainValidationCode,
    message: string,
    options: { field?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DomainValidationError";
    this.code = code;
    this.field = options.field ?? null;
  }
}

/** Narrowing helper so callers do not need `instanceof` checks inline. */
export function isDomainValidationError(value: unknown): value is DomainValidationError {
  return value instanceof DomainValidationError;
}

/** True for non-null, non-array objects, i.e. things that can be safely keyed into. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-throwing video id guard, reused by the YouTube normalizers. */
export function isVideoId(value: unknown): value is string {
  return typeof value === "string" && VIDEO_ID_PATTERN.test(value);
}

/**
 * Trimmed, non-empty search query of at most 100 characters (code points),
 * without control characters.
 */
export function assertSearchQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainValidationError("invalid_type", "Search query must be a string.", {
      field: "searchQuery",
    });
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainValidationError("empty_value", "Search query must not be empty.", {
      field: "searchQuery",
    });
  }

  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    throw new DomainValidationError(
      "control_characters",
      "Search query must not contain control characters.",
      { field: "searchQuery" },
    );
  }

  if (countCodePoints(trimmed) > MAX_SEARCH_QUERY_LENGTH) {
    throw new DomainValidationError(
      "too_long",
      `Search query must be at most ${MAX_SEARCH_QUERY_LENGTH} characters.`,
      { field: "searchQuery" },
    );
  }

  return trimmed;
}

/** Exactly 11 characters from `[A-Za-z0-9_-]`. Surrounding whitespace is not accepted. */
export function assertVideoId(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainValidationError("invalid_type", "Video id must be a string.", {
      field: "videoId",
    });
  }

  if (!VIDEO_ID_PATTERN.test(value)) {
    throw new DomainValidationError(
      "invalid_format",
      `Video id must be exactly ${VIDEO_ID_LENGTH} characters from [A-Za-z0-9_-].`,
      { field: "videoId" },
    );
  }

  return value;
}

/** Trimmed playlist name of 1 to 60 characters (code points). */
export function assertPlaylistName(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainValidationError("invalid_type", "Playlist name must be a string.", {
      field: "playlistName",
    });
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainValidationError("empty_value", "Playlist name must not be empty.", {
      field: "playlistName",
    });
  }

  if (countCodePoints(trimmed) > MAX_PLAYLIST_NAME_LENGTH) {
    throw new DomainValidationError(
      "too_long",
      `Playlist name must be at most ${MAX_PLAYLIST_NAME_LENGTH} characters.`,
      { field: "playlistName" },
    );
  }

  return trimmed;
}

/**
 * Page token guard. Absent tokens (null, undefined, empty string) normalize to null.
 * Anything else must be URL-safe and no longer than 512 characters.
 */
export function assertPageToken(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new DomainValidationError("invalid_type", "Page token must be a string.", {
      field: "pageToken",
    });
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > MAX_PAGE_TOKEN_LENGTH) {
    throw new DomainValidationError(
      "too_long",
      `Page token must be at most ${MAX_PAGE_TOKEN_LENGTH} characters.`,
      { field: "pageToken" },
    );
  }

  if (!PAGE_TOKEN_PATTERN.test(trimmed)) {
    throw new DomainValidationError(
      "invalid_format",
      "Page token must contain only URL-safe characters.",
      { field: "pageToken" },
    );
  }

  return trimmed;
}

/** Counts characters by code point so a 100-emoji query is still 100 characters. */
function countCodePoints(value: string): number {
  return Array.from(value).length;
}
