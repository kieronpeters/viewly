/**
 * Query layer for the local playback-progress table (T68).
 *
 * ## Shape
 *
 * Like the library and notes repositories, this module exports a factory
 * ({@link createProgressRepository}) instead of a process-wide singleton:
 * callers pass the Drizzle client they already have, and tests build their own
 * against a migrated temporary file.
 *
 * ```ts
 * import { getDb } from "@/lib/db/client";
 * import { createProgressRepository } from "@/lib/db/repositories/progress.repository";
 *
 * const progress = createProgressRepository(getDb());
 * ```
 *
 * No module here imports the connection singleton, so importing this file has
 * no I/O side effect.
 *
 * ## One row per video
 *
 * `video_progress.video_id` is the primary key, so {@link
 * ProgressRepository.save} is a single `INSERT ... ON CONFLICT DO UPDATE`
 * (upsert): the player may report the same video on every throttled tick and
 * the last write wins. There is no read-modify-write race to lose, and a new
 * video costs one row.
 *
 * ## Clearing
 *
 * {@link ProgressRepository.clear} deletes the row and reports whether one was
 * removed, so repeating it is safe. The watch page calls it when the viewer
 * chooses "Start over"; the action calls it when playback reaches 95%, which
 * keeps the table limited to genuinely in-progress videos.
 *
 * ## Time
 *
 * Nothing here reads the wall clock: {@link SaveVideoProgressInput.updatedAt}
 * is supplied by the caller (the Server Action uses `new Date()`), so tests
 * control ordering exactly.
 *
 * ## Validation
 *
 * Video-id and numeric validation belongs to the domain layer
 * (`src/features/progress/progress.ts`). This module stores what it is given
 * and only clamps `positionSeconds` to `durationSeconds`, so a seek past the
 * end cannot overflow a card's progress bar.
 *
 * ## Continue watching
 *
 * {@link ProgressRepository.listContinueWatching} joins this table to the three
 * stored display snapshots (`history`, `favourites`, `watch_later`), so a home
 * or library shelf can render a card without a YouTube call. The fraction is
 * checked with integer arithmetic (`position * 100` against `duration * 5` /
 * `duration * 95`) to avoid floating-point boundary noise. A progress row with
 * no snapshot anywhere has nothing to display and is excluded by the join
 * filter, not rendered as a placeholder.
 */
import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { favourites, history, videoProgress, watchLater } from "@/db/schema";
import type { ViewlyDatabase } from "@/lib/db/client";

/** A row of `video_progress`, with `updatedAt` as a `Date`. */
export type VideoProgressRow = typeof videoProgress.$inferSelect;

/**
 * One in-progress video joined to a stored display snapshot.
 *
 * The snapshot columns are denormalised per list; when a video appears in more
 * than one list this query picks `history` first (it is refreshed on every
 * view), then `favourites`, then `watch_later`.
 */
export interface ContinueWatchingRow {
  /** YouTube video id. */
  videoId: string;
  /** Snapshot title. */
  title: string;
  /** Snapshot channel name. */
  channelTitle: string;
  /** Snapshot thumbnail URL. */
  thumbnailUrl: string;
  /** Snapshot duration; `null` for live streams or missing details. */
  durationSeconds: number | null;
  /** Last reported position in whole seconds. */
  positionSeconds: number;
  /** Duration the progress bar must be measured against. */
  progressDurationSeconds: number;
  /** When the position was last written; the list is newest first. */
  updatedAt: Date;
}

/** Input for {@link ProgressRepository.save}. */
export interface SaveVideoProgressInput {
  /** YouTube video id. */
  videoId: string;
  /** Last reported position in whole seconds; clamped to `durationSeconds`. */
  positionSeconds: number;
  /** Total duration in whole seconds; positive. */
  durationSeconds: number;
  /** When the position was written, UTC milliseconds. */
  updatedAt: Date;
}

/** Typed query surface for `video_progress`. */
export interface ProgressRepository {
  /** One video's stored progress, or `undefined` when there is none. */
  get(videoId: string): VideoProgressRow | undefined;
  /**
   * Stored progress for the given videos, in repository order.
   *
   * An empty input returns an empty array without running a query, which keeps
   * the library's empty-tab render free of `IN ()` (invalid SQL).
   */
  listForVideos(videoIds: readonly string[]): VideoProgressRow[];
  /**
   * Inserts or replaces one video's progress and returns the stored row.
   *
   * `positionSeconds` is clamped to `durationSeconds`; the caller is expected to
   * have validated both values already.
   */
  save(input: SaveVideoProgressInput): VideoProgressRow;
  /**
   * Videos between 5% and 95% complete, joined to their stored display
   * snapshot and ordered by most recently reported progress.
   *
   * A video with progress but no row in any of the three snapshot tables is
   * omitted: there is no title, thumbnail or channel to render. Reads only the
   * local database, so a continue-watching shelf costs no YouTube call.
   */
  listContinueWatching(): ContinueWatchingRow[];
  /** Deletes one video's progress. Returns `true` when a row was removed. */
  clear(videoId: string): boolean;
}

/** Builds the typed progress query surface over an existing Drizzle client. */
export function createProgressRepository(db: ViewlyDatabase): ProgressRepository {
  return {
    get(videoId) {
      return db.select().from(videoProgress).where(eq(videoProgress.videoId, videoId)).get();
    },

    listForVideos(videoIds) {
      if (videoIds.length === 0) {
        return [];
      }

      return db
        .select()
        .from(videoProgress)
        .where(inArray(videoProgress.videoId, [...videoIds]))
        .all();
    },

    save(input) {
      const positionSeconds = Math.min(
        Math.max(Math.floor(input.positionSeconds), 0),
        Math.floor(input.durationSeconds),
      );

      const row = db
        .insert(videoProgress)
        .values({
          videoId: input.videoId,
          positionSeconds,
          durationSeconds: Math.floor(input.durationSeconds),
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: videoProgress.videoId,
          set: {
            positionSeconds,
            durationSeconds: Math.floor(input.durationSeconds),
            updatedAt: input.updatedAt,
          },
        })
        .returning()
        .get();

      if (row === undefined) {
        throw new Error(`Progress for ${input.videoId} was not returned by the upsert.`);
      }

      return row;
    },

    listContinueWatching() {
      // Three left joins because a video may live in none, one or several of
      // the snapshot tables. `coalesce` supplies the display fields from the
      // first list that has the row; the `or` filter then drops progress rows
      // whose snapshot is missing everywhere, since a card cannot be built.
      return db
        .select({
          videoId: videoProgress.videoId,
          title: sql<string>`coalesce(${history.title}, ${favourites.title}, ${watchLater.title})`,
          channelTitle: sql<string>`coalesce(${history.channelTitle}, ${favourites.channelTitle}, ${watchLater.channelTitle})`,
          thumbnailUrl: sql<string>`coalesce(${history.thumbnailUrl}, ${favourites.thumbnailUrl}, ${watchLater.thumbnailUrl})`,
          durationSeconds: sql<
            number | null
          >`coalesce(${history.durationSeconds}, ${favourites.durationSeconds}, ${watchLater.durationSeconds})`,
          positionSeconds: videoProgress.positionSeconds,
          progressDurationSeconds: videoProgress.durationSeconds,
          updatedAt: videoProgress.updatedAt,
        })
        .from(videoProgress)
        .leftJoin(history, eq(history.videoId, videoProgress.videoId))
        .leftJoin(favourites, eq(favourites.videoId, videoProgress.videoId))
        .leftJoin(watchLater, eq(watchLater.videoId, videoProgress.videoId))
        .where(
          and(
            // Integer arithmetic, matching `isResumableProgress`: at least 5%
            // and strictly below 95%. Avoids float rounding at the boundaries.
            sql`${videoProgress.positionSeconds} * 100 >= ${videoProgress.durationSeconds} * 5`,
            sql`${videoProgress.positionSeconds} * 100 < ${videoProgress.durationSeconds} * 95`,
            or(
              isNotNull(history.videoId),
              isNotNull(favourites.videoId),
              isNotNull(watchLater.videoId),
            ),
          ),
        )
        .orderBy(desc(videoProgress.updatedAt), asc(videoProgress.videoId))
        .all();
    },

    clear(videoId) {
      return db.delete(videoProgress).where(eq(videoProgress.videoId, videoId)).run().changes > 0;
    },
  };
}
