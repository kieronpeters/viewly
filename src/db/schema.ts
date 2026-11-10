/**
 * Drizzle schema for the Viewly SQLite database (the personal video library).
 *
 * Drizzle Kit loads this module, discovers every exported `sqliteTable` and
 * generates SQL into `src/db/migrations`. Run `npm run db:generate` after any
 * change here and commit the generated SQL together with the schema.
 *
 * ## Timestamps
 *
 * Every `*At` column is UTC milliseconds using `integer(..., { mode:
 * "timestamp_ms" })`, so Drizzle reads and writes `Date` objects while SQLite
 * stores a plain integer that sorts and compares correctly. SQL-time text
 * defaults (`CURRENT_TIMESTAMP`) are deliberately not used: they are
 * second-precision, local-time text and would not round-trip through
 * `timestamp_ms`. Repositories pass the timestamps they want; nothing here
 * reads the clock.
 *
 * ## Display snapshots
 *
 * `favourites`, `watch_later` and `history` each store the same denormalised
 * snapshot of a video (`title`, `channel_title`, `thumbnail_url`,
 * `duration_seconds`). The snapshot is intentionally per-row rather than a
 * foreign key to a `videos` cache: a saved item must still render when the
 * YouTube API is unavailable or the video is deleted, and different users of
 * the same browser profile may have snapshotted a video at different times.
 * Keep the three copies in sync; {@link displaySnapshotColumns} is the single
 * factory, so a new column is added in one place.
 *
 * `duration_seconds` is nullable because the YouTube API omits `PT#M#S` for
 * live streams and for videos whose details are unavailable.
 *
 * ## Constraints
 *
 * - Primary keys are natural: the YouTube video id is unique per list, so a
 *   duplicated save is rejected by SQLite rather than by a read-modify-write.
 * - `playlist_items` uses the composite key `(playlist_id, video_id)`: a video
 *   appears at most once per playlist, so "add to playlist" is idempotent at
 *   the storage layer. `position` is a separate, mutable ordering column.
 * - `playlist_items.playlist_id` cascades on delete, so removing a playlist
 *   never leaves orphaned rows. SQLite enforces this only when
 *   `PRAGMA foreign_keys = ON`; `src/lib/db/client.ts` sets it on every
 *   connection. Any other connection (scripts, tests, `sqlite3`) must set it
 *   too, otherwise `DELETE FROM playlists` silently leaves the items behind.
 * - `CHECK` constraints guard the numeric columns that would otherwise accept
 *   nonsense: `history.view_count >= 0`, `playlist_items.position >= 0`,
 *   `video_progress.position_seconds >= 0`, and
 *   `video_notes.start_seconds IS NULL OR start_seconds >= 0` (T90).
 *   SQLite raises `SQLITE_CONSTRAINT_CHECK` on violation.
 *
 * ## Indexes
 *
 * The indexes cover the orderings the library screens need:
 *
 * - `history(last_viewed_at)`, `favourites(saved_at)`,
 *   `watch_later(saved_at)` for "most recent first" lists.
 * - `playlist_items(playlist_id, position)` for reading a playlist in display
 *   order; it also serves lookups by `playlist_id` alone (leftmost prefix).
 * - `video_notes(video_id, created_at)` for one video's notes, newest first
 *   (T79). It also serves lookups by `video_id` alone.
 * - `video_notes(video_id, start_seconds)` for one video's timestamps in
 *   playback order (T90), including the partial lookups that filter
 *   `start_seconds IS NOT NULL` from the leftmost `video_id` column.
 * - `video_progress(updated_at)` for "most recently watched" orderings and for
 *   pruning stale rows (T68). Point lookups use the primary key.
 *
 * ## Next.js 16 `cacheComponents`
 *
 * `cacheComponents` is enabled in `next.config.ts`. These tables are read by
 * synchronous `better-sqlite3` queries, which are not cached by Next.js, so
 * any request-time read in a Server Component must be wrapped in
 * `connection()` from `next/server` (or live behind a `Suspense` boundary) to
 * opt that segment into request-time rendering. A module-level read outside a
 * request would otherwise be captured during prerendering. That wiring belongs
 * to the feature/repository tickets, not to this schema file.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Column builders for the denormalised video display snapshot shared by
 * `favourites`, `watch_later` and `history`.
 *
 * Returns fresh builders on every call: Drizzle builders are mutable
 * (`notNull()` mutates the builder it is called on), so sharing a single
 * builder object between tables would couple them.
 */
function displaySnapshotColumns() {
  return {
    /** Video title at the moment it was saved or last viewed. */
    title: text("title").notNull(),
    /** Channel name at the moment it was saved or last viewed. */
    channelTitle: text("channel_title").notNull(),
    /** Absolute thumbnail URL, stored so the row renders without an API call. */
    thumbnailUrl: text("thumbnail_url").notNull(),
    /** Duration in whole seconds; `null` for live streams or missing details. */
    durationSeconds: integer("duration_seconds"),
  };
}

/** Videos the user explicitly saved ("favourites"), newest first. */
export const favourites = sqliteTable(
  "favourites",
  {
    /** YouTube video id, for example `dQw4w9WgXcQ`. Natural primary key. */
    videoId: text("video_id").primaryKey(),
    ...displaySnapshotColumns(),
    /** When the video was saved, UTC milliseconds. */
    savedAt: integer("saved_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("favourites_saved_at_idx").on(table.savedAt)],
);

/** Videos queued for later viewing ("watch later"), newest first. */
export const watchLater = sqliteTable(
  "watch_later",
  {
    /** YouTube video id. Natural primary key. */
    videoId: text("video_id").primaryKey(),
    ...displaySnapshotColumns(),
    /** When the video was added to the queue, UTC milliseconds. */
    savedAt: integer("saved_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("watch_later_saved_at_idx").on(table.savedAt)],
);

/**
 * Watch history: one row per video, with a view counter.
 *
 * A video is never stored twice; watching it again bumps `view_count` and
 * `last_viewed_at` instead of inserting a new row.
 */
export const history = sqliteTable(
  "history",
  {
    /** YouTube video id. Natural primary key. */
    videoId: text("video_id").primaryKey(),
    ...displaySnapshotColumns(),
    /** Most recent view, UTC milliseconds. Drives "recently watched". */
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp_ms" }).notNull(),
    /** Number of recorded views; incremented on every view, never negative. */
    viewCount: integer("view_count").notNull().default(1),
  },
  (table) => [
    index("history_last_viewed_at_idx").on(table.lastViewedAt),
    check("history_view_count_non_negative", sql`${table.viewCount} >= 0`),
  ],
);

/** User-created playlists. Ordering lives in `playlist_items.position`. */
export const playlists = sqliteTable("playlists", {
  /**
   * Application-generated id (`crypto.randomUUID()`), not an
   * auto-incrementing integer: playlists may be created offline and merged.
   */
  id: text("id").primaryKey(),
  /** User-visible playlist name. May be duplicated; no uniqueness rule. */
  name: text("name").notNull(),
  /** Creation time, UTC milliseconds. */
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** Last rename or reorder time, UTC milliseconds. */
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Small key/value store for application settings that are not library data.
 *
 * The first user is the metadata sweep's `last_sweep_at` marker (T46): the
 * value is an ISO-8601 timestamp and the row records when it was written.
 * Keeping it in SQLite rather than in memory means a restart does not trigger
 * an unnecessary sweep, and keeping it out of the three library tables means
 * their display snapshot contract is unchanged.
 *
 * `value` is text so a setting can hold a timestamp, a flag or a small JSON
 * payload without a migration; each caller owns the interpretation of its key.
 */
export const settings = sqliteTable("settings", {
  /** Stable setting name, for example `last_sweep_at`. */
  key: text("key").primaryKey(),
  /** Serialized setting value; never null, an empty string is a valid value. */
  value: text("value").notNull(),
  /** When the setting was last written, UTC milliseconds. */
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Membership and ordering of videos inside a playlist.
 *
 * The composite primary key `(playlist_id, video_id)` makes "add to playlist"
 * idempotent; `position` is unique only by convention, so reordering can move
 * a row without temporarily colliding with its neighbour in SQLite (which has
 * no deferred unique constraints).
 */
export const playlistItems = sqliteTable(
  "playlist_items",
  {
    /** Owning playlist; deleting the playlist deletes these rows. */
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    /** YouTube video id. */
    videoId: text("video_id").notNull(),
    /** Zero-based display order inside the playlist. */
    position: integer("position").notNull(),
    /** When the video was added to the playlist, UTC milliseconds. */
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "playlist_items_playlist_id_video_id_pk",
      columns: [table.playlistId, table.videoId],
    }),
    index("playlist_items_playlist_id_position_idx").on(table.playlistId, table.position),
    check("playlist_items_position_non_negative", sql`${table.position} >= 0`),
  ],
);

/**
 * Free-text notes and timestamped highlights the viewer writes about a video
 * (T79, extended by T90).
 *
 * Notes are local-only: there is no author column, no account and no network
 * call. They are deliberately not a YouTube comment — the watch page's
 * "Your notes" panel is a private scratchpad, and the two lists never share a
 * row or a renderer.
 *
 * ## Notes and highlights
 *
 * One table holds both concepts, distinguished by {@link videoNotes.startSeconds}:
 *
 * - `start_seconds IS NULL` — a free-text note, exactly the T79 shape;
 * - `start_seconds IS NOT NULL` — a highlight anchored to a playback position.
 *
 * A highlight is a note with a timestamp, not a separate entity: it keeps the
 * same id, body and edit/delete actions, and the watch panel renders the
 * timestamped rows as the video's Highlights list ordered by time. Storing the
 * two concepts in one table keeps T87's export/import scope to one row shape;
 * an export carries every column below, including the nullable
 * `start_seconds`, and an import restores it verbatim so a highlight keeps its
 * anchor.
 *
 * `id` is application-generated (`crypto.randomUUID()`) rather than
 * auto-incrementing, matching `playlists`: an edit keeps the note's identity
 * and a future export/import (T87) can merge rows without depending on
 * insertion order.
 *
 * `created_at` drives the newest-first notes list; `updated_at` is bumped on
 * every edit so the UI can show when a note last changed. Editing a note never
 * changes `start_seconds`, so a highlight does not jump in the ordered list
 * while its body is being revised. Both `*At` columns are UTC milliseconds,
 * like every other `*At` column, and the repository supplies them — nothing in
 * the schema reads the clock.
 *
 * `video_id` is a plain text column rather than a foreign key because there is
 * no `videos` table: the YouTube catalogue is never persisted, and a note must
 * survive a video that the API stops returning.
 *
 * ## Timestamp bounds
 *
 * `start_seconds` is a whole, non-negative number of seconds; the CHECK rejects
 * negative values at the storage layer. The upper bound is the video's
 * duration, which is not stored here (a note outlives a changed or unavailable
 * duration), so the Server Action validates `0 <= start_seconds <= duration`
 * with the duration the player reported before writing. Existing rows from
 * before T90 migrate with `NULL`, which is the free-text meaning.
 */
export const videoNotes = sqliteTable(
  "video_notes",
  {
    /** Application-generated id, stable across edits. */
    id: text("id").primaryKey(),
    /** YouTube video id the note belongs to. */
    videoId: text("video_id").notNull(),
    /** Plain-text note body, 1-2000 characters (validated before writing). */
    body: text("body").notNull(),
    /**
     * Playback position in whole seconds for a highlight, or `null` for a
     * free-text note without a timestamp.
     */
    startSeconds: integer("start_seconds"),
    /** Creation time, UTC milliseconds. */
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Last edit time, UTC milliseconds; equals `createdAt` for a new note. */
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("video_notes_video_id_created_at_idx").on(table.videoId, table.createdAt),
    index("video_notes_video_id_start_seconds_idx").on(table.videoId, table.startSeconds),
    check(
      "video_notes_start_seconds_non_negative",
      sql`${table.startSeconds} is null or ${table.startSeconds} >= 0`,
    ),
  ],
);

/**
 * Local playback position per video (T68).
 *
 * One row per video, written while the watch player is playing and read by the
 * resume prompt and the library cards. No row means "never started or finished":
 * the player deletes the row once playback crosses 95%, and "Start over" deletes
 * it explicitly, so the table only ever holds genuinely in-progress videos.
 *
 * `duration_seconds` is stored rather than inferred from the YouTube API because
 * a progress bar must still render when the API is unavailable or the video's
 * duration has changed since the last watch. `position_seconds` is the last
 * reported position and is validated to be non-negative; the repository clamps
 * it to `duration_seconds` so a seek past the end cannot make a bar overflow.
 *
 * This table is deliberately independent of `history`: clearing history does not
 * forget where the viewer stopped, and a video can have progress without being
 * listed in history yet. `video_id` is a plain text column for the same reason
 * as `video_notes` — there is no `videos` table to reference.
 */
export const videoProgress = sqliteTable(
  "video_progress",
  {
    /** YouTube video id. Natural primary key: one position per video. */
    videoId: text("video_id").primaryKey(),
    /** Last reported playback position in whole seconds; never negative. */
    positionSeconds: integer("position_seconds").notNull(),
    /** Total duration in whole seconds, as reported by the player. */
    durationSeconds: integer("duration_seconds").notNull(),
    /** When the position was last written, UTC milliseconds. */
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("video_progress_updated_at_idx").on(table.updatedAt),
    check("video_progress_position_non_negative", sql`${table.positionSeconds} >= 0`),
    check("video_progress_duration_positive", sql`${table.durationSeconds} > 0`),
  ],
);
