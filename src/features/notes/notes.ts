/**
 * Client-safe core of the local watch-page notes (T79).
 *
 * This module holds the shared shape, the input parsers and the timestamp
 * formatter. It deliberately has **no runtime dependency** on the database
 * layer: `VideoNoteRow` is imported as a type only, so a Client Component may
 * import these helpers without pulling `better-sqlite3` (or the `server-only`
 * guard) into the browser bundle. The server-only entry points live in
 * `notes-data.ts` (reads) and `actions.ts` (mutations).
 *
 * Validation reuses `src/shared/validation.ts` so the action and any future
 * caller agree on exactly what a note is: 1-2000 characters, trimmed, with
 * line breaks preserved.
 */
import type { VideoNoteRow } from "@/lib/db/repositories/notes.repository";
import { DomainValidationError, assertNoteBody } from "@/shared/validation";

/** A note as it crosses the Server Action / Server Component boundary. */
export interface VideoNote {
  /** Application-generated id, stable across edits. */
  id: string;
  /** YouTube video id the note belongs to. */
  videoId: string;
  /** Plain-text body, already normalized by {@link parseNoteBody}. */
  body: string;
  /** Creation time, ISO-8601, for `<time dateTime>` and display. */
  createdAt: string;
  /** Last edit time, ISO-8601; equal to `createdAt` for a new note. */
  updatedAt: string;
}

/** Application ids are UUIDs, but the guard accepts any short URL-safe token. */
const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** English month names, indexed by `Date#getUTCMonth()`. */
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Validates and normalizes an untrusted note body. */
export function parseNoteBody(input: unknown): string {
  return assertNoteBody(input);
}

/**
 * Validates an untrusted note id.
 *
 * Ids are internal, but they still cross the Server Action boundary (the
 * browser sends them back when editing or deleting), so a malformed value is
 * rejected as a validation error rather than reaching a query.
 */
export function parseNoteId(input: unknown): string {
  if (typeof input !== "string") {
    throw new DomainValidationError("invalid_type", "Note id must be a string.", {
      field: "noteId",
    });
  }

  if (!NOTE_ID_PATTERN.test(input)) {
    throw new DomainValidationError("invalid_format", "Note id must be 1-64 URL-safe characters.", {
      field: "noteId",
    });
  }

  return input;
}

/** Maps a repository row to the serializable shape the UI stores. */
export function noteFromRow(row: VideoNoteRow): VideoNote {
  return {
    id: row.id,
    videoId: row.videoId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Formats a note timestamp as `10 Nov 2026, 14:32` in UTC.
 *
 * Deterministic by design, like the rest of this app's formatters: no `Intl`,
 * no ambient locale, so the server-rendered markup and the hydrated client
 * agree. Returns `null` for an empty or unparseable timestamp so the caller
 * can omit the `<time>` element instead of printing "Invalid Date".
 */
export function formatNoteTimestamp(iso: string): string | null {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = date.getUTCDate();
  const month = MONTH_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}
