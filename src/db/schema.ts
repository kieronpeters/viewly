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
 *   nonsense: `history.view_count >= 0` and `playlist_items.position >= 0`.
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
