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
 *
 * ## Notes and highlights (T90)
 *
 * A note with `startSeconds === null` is free text. A note with a number is a
 * **highlight** anchored to that playback position. Both are the same row
 * shape and the same actions; {@link partitionVideoNotes} separates them for
 * the panel, and {@link parseNoteStartSeconds} validates an untrusted
 * timestamp against the player-reported duration.
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
  /**
   * Playback position in whole seconds for a highlight, or `null` for a
   * free-text note without a timestamp.
   */
  startSeconds: number | null;
  /** Creation time, ISO-8601, for `<time dateTime>` and display. */
  createdAt: string;
  /** Last edit time, ISO-8601; equal to `createdAt` for a new note. */
  updatedAt: string;
}

/** A validated playback anchor supplied when saving a highlight. */
export interface NotePosition {
  /** Position in whole seconds, `0 <= startSeconds <= durationSeconds`. */
  startSeconds: number;
  /** Duration reported by the player; `0` when it is not known yet. */
  durationSeconds: number;
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

/**
 * Validates an untrusted playback anchor for a highlight (T90).
 *
 * - `null`/`undefined` means "no timestamp": a free-text note, returned as
 *   `null`.
 * - A finite number is floored to whole seconds; `0` is valid (the very start
 *   of the video), so is a position exactly at the end.
 * - A negative or non-finite value, or a non-number, is rejected.
 * - When a positive `durationSeconds` is supplied, a position past it is
 *   rejected as out of range. A duration of `0` (or a missing one) means the
 *   player has not reported the length yet (or the video is live), so no upper
 *   bound is applied; the position is still non-negative.
 *
 * The duration is supplied by the player and crosses the Server Action
 * boundary, so it is validated here as an untrusted value too. The database
 * stores only the position; see `video_notes` in `src/db/schema.ts` for why the
 * duration is not persisted.
 */
export function parseNoteStartSeconds(
  startSeconds: unknown,
  durationSeconds: unknown = null,
): number | null {
  if (startSeconds === null || startSeconds === undefined) {
    return null;
  }

  if (typeof startSeconds !== "number") {
    throw new DomainValidationError("invalid_type", "Note timestamp must be a number or null.", {
      field: "startSeconds",
    });
  }

  if (!Number.isFinite(startSeconds)) {
    throw new DomainValidationError("invalid_format", "Note timestamp must be finite.", {
      field: "startSeconds",
    });
  }

  const position = Math.floor(startSeconds);

  if (position < 0) {
    throw new DomainValidationError("out_of_range", "Note timestamp must not be negative.", {
      field: "startSeconds",
    });
  }

  if (durationSeconds !== null && durationSeconds !== undefined) {
    if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) {
      throw new DomainValidationError("invalid_format", "Video duration must be a finite number.", {
        field: "durationSeconds",
      });
    }

    const duration = Math.floor(durationSeconds);

    if (duration > 0 && position > duration) {
      throw new DomainValidationError(
        "out_of_range",
        "Note timestamp must not be past the end of the video.",
        { field: "startSeconds" },
      );
    }
  }

  return position;
}

/**
 * Splits a video's notes into the two lists the panel renders (T90).
 *
 * `notes` keeps the incoming order (the repository returns newest first) and
 * contains only rows without a timestamp. `highlights` contains the timestamped
 * rows sorted by `startSeconds`, then creation time and id, so two highlights on
 * the same second still have a stable order. The input array is never mutated.
 */
export function partitionVideoNotes(notes: readonly VideoNote[]): {
  notes: VideoNote[];
  highlights: VideoNote[];
} {
  const freeText: VideoNote[] = [];
  const highlights: VideoNote[] = [];

  for (const note of notes) {
    if (note.startSeconds === null) {
      freeText.push(note);
    } else {
      highlights.push(note);
    }
  }

  highlights.sort((left, right) => {
    const byPosition = (left.startSeconds ?? 0) - (right.startSeconds ?? 0);

    if (byPosition !== 0) {
      return byPosition;
    }

    const byCreatedAt = left.createdAt.localeCompare(right.createdAt);

    return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id);
  });

  return { notes: freeText, highlights };
}

/** Maps a repository row to the serializable shape the UI stores. */
export function noteFromRow(row: VideoNoteRow): VideoNote {
  return {
    id: row.id,
    videoId: row.videoId,
    body: row.body,
    startSeconds: row.startSeconds,
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
