/**
 * Shared guard for the local SQLite reads that render a page.
 *
 * A Viewly database file can predate the migrations that added a table (the
 * known case is a v0.1.0 file without `video_progress` and `video_notes`).
 * SQLite reports that as a plain `SQLITE_ERROR` with the message
 * `no such table: <name>`, which would otherwise reach the React error boundary
 * as a raw 500. The page cannot fix the database at request time, so it turns
 * the failure into a value the UI can explain instead.
 *
 * This module is pure: it takes the read as a callback and never opens a
 * database, logs or reads the clock.
 */

/** Status returned when the local schema is behind the committed migrations. */
export const DATABASE_NEEDS_UPDATE = "database_needs_update" as const;

/** Result of a guarded local read. */
export type DatabaseRead<T> = { status: "ok"; value: T } | { status: typeof DATABASE_NEEDS_UPDATE };

/**
 * True for SQLite's "this table does not exist" failure.
 *
 * `better-sqlite3` raises a `SqliteError` with `code: "SQLITE_ERROR"` and a
 * message naming the missing table. The message check is what matters; the code
 * check also accepts an error double that only carries the message.
 */
export function isMissingTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  if (typeof message !== "string" || !/\bno such table\b/i.test(message)) {
    return false;
  }

  return code === undefined || code === "SQLITE_ERROR";
}

/**
 * Runs `read` and converts a missing-table failure into
 * {@link DATABASE_NEEDS_UPDATE}. Every other failure is rethrown unchanged, so
 * genuine bugs and request-time failures still reach the existing boundary.
 */
export function readDatabase<T>(read: () => T): DatabaseRead<T> {
  try {
    return { status: "ok", value: read() };
  } catch (error) {
    if (isMissingTableError(error)) {
      return { status: DATABASE_NEEDS_UPDATE };
    }

    throw error;
  }
}
