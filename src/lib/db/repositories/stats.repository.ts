/**
 * Aggregate query layer for the local watch-stats page (T85).
 *
 * ## Why a separate repository
 *
 * The library repository owns row-level CRUD for favourites, watch later,
 * history and playlists. Stats need grouped reads — `SUM`, `COUNT`, `GROUP BY`
 * and a UTC day projection — which would bloat that module and tempt callers to
 * hand-write SQL in a feature. Every aggregate lives here instead; the stats
 * feature module only maps these rows to the UI and does not import `sql`.
 *
 * ## What is stored (and what is therefore estimable)
 *
 * `history` keeps one row per video with a `view_count` and a single
 * `last_viewed_at`; it does not keep one row per playback. Watch time is
 * therefore **estimated**, never measured:
 *
 * ```
 * estimatedWatchSeconds = SUM(duration_seconds * view_count)
 * ```
 *
 * Rows with `duration_seconds IS NULL` (live streams or metadata that could not
 * be fetched) contribute nothing and are counted separately as
 * {@link WatchTotals.videosMissingDuration}, so the UI can label the total as an
 * estimate and say how many videos were excluded.
 *
 * The same limitation applies to the daily breakdown: a video's estimated time
 * is attributed entirely to the UTC day of its *last* view. A video watched on
 * three different days has all three views counted on the latest day.
 *
 * ## Days and time
 *
 * Days are UTC calendar days (`YYYY-MM-DD`). Nothing here reads the wall clock;
 * callers pass the window (`start`, `endExclusive`) or the reference `now` so
 * tests are deterministic and the page resolves its clock in one place.
 *
 * ## Performance
 *
 * The queries only aggregate the small local `history` table, use
 * `history_last_viewed_at_idx` for the window, and materialise no row lists
 * except `activeDays` (one short string per active day, needed for the streak).
 * `getWatchStats` skips the remaining reads on a fresh install.
 */
import "server-only";

import { and, asc, count, desc, gte, lt, sql } from "drizzle-orm";

import { history } from "@/db/schema";
import type { ViewlyDatabase } from "@/lib/db/client";

/**
 * SQL expression for the UTC calendar day of a history row.
 *
 * `last_viewed_at` is stored as UTC milliseconds, so dividing by 1000 gives the
 * Unix seconds `date()` expects. Reused for `SELECT`, `GROUP BY` and `ORDER BY`
 * so the three clauses cannot drift apart.
 */
const utcDayExpression = sql<string>`date(${history.lastViewedAt} / 1000, 'unixepoch')`;

/** Library-wide totals over the watched videos. */
export interface WatchTotals {
  /** Distinct videos in history (`COUNT(*)`). */
  videosWatched: number;
  /** Sum of local view counters, including repeat views. */
  totalViews: number;
  /** `SUM(durationSeconds * viewCount)`; an estimate, see the module docs. */
  estimatedWatchSeconds: number;
  /** Rows whose duration is unknown; they contribute no estimated time. */
  videosMissingDuration: number;
}

/** One channel's share of the watched library. */
export interface ChannelWatchStat {
  /** Channel name stored in the history snapshot. */
  channelTitle: string;
  /** Distinct videos from this channel in history. */
  videosWatched: number;
  /** Sum of local view counters for those videos. */
  totalViews: number;
  /** Estimated time, same formula as {@link WatchTotals.estimatedWatchSeconds}. */
  estimatedWatchSeconds: number;
}

/** One UTC day of activity, for the 12-week heatmap. */
export interface DailyWatchStat {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Videos whose last view falls on this day. */
  videosWatched: number;
  /** Sum of those videos' local view counters. */
  totalViews: number;
  /** Estimated time attributed to this day. */
  estimatedWatchSeconds: number;
}

/** Typed aggregate surface over the history table. */
export interface StatsRepository {
  /** Whole-history totals in one aggregate query. */
  totals(): WatchTotals;
  /** Channels ordered by estimated time, then name; at most `limit` rows. */
  topChannels(limit: number): ChannelWatchStat[];
  /**
   * Per-UTC-day aggregates for `[start, endExclusive)`.
   *
   * Days with no history rows are omitted; the feature fills the gaps so the
   * heatmap always has one cell per day.
   */
  dailyActivity(start: Date, endExclusive: Date): DailyWatchStat[];
  /**
   * Distinct UTC days with at least one recorded view, newest first.
   *
   * One short string per active day; used to compute the current streak without
   * a recursive SQL query.
   */
  activeDays(): string[];
}

/**
 * Builds the stats query surface over an existing Drizzle client.
 *
 * Like the library repository, the client is captured once, so constructing
 * this is cheap and has no I/O side effect.
 */
export function createStatsRepository(db: ViewlyDatabase): StatsRepository {
  return {
    totals() {
      const row = db
        .select({
          videosWatched: count(),
          totalViews: sql<number>`coalesce(sum(${history.viewCount}), 0)`,
          estimatedWatchSeconds: sql<number>`coalesce(sum(${history.durationSeconds} * ${history.viewCount}), 0)`,
          videosMissingDuration: sql<number>`coalesce(sum(case when ${history.durationSeconds} is null then 1 else 0 end), 0)`,
        })
        .from(history)
        .get();

      // An aggregate without GROUP BY always returns one row, but defaulting
      // keeps the function total and avoids a non-null assertion.
      return {
        videosWatched: row?.videosWatched ?? 0,
        totalViews: row?.totalViews ?? 0,
        estimatedWatchSeconds: row?.estimatedWatchSeconds ?? 0,
        videosMissingDuration: row?.videosMissingDuration ?? 0,
      };
    },

    topChannels(limit) {
      // A negative or fractional limit is meaningless to SQLite, so normalise
      // it once. Zero is allowed and returns no rows.
      const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;

      if (safeLimit === 0) {
        return [];
      }

      const estimatedWatchSeconds = sql<number>`coalesce(sum(${history.durationSeconds} * ${history.viewCount}), 0)`;

      return db
        .select({
          channelTitle: history.channelTitle,
          videosWatched: count(),
          totalViews: sql<number>`coalesce(sum(${history.viewCount}), 0)`,
          estimatedWatchSeconds,
        })
        .from(history)
        .groupBy(history.channelTitle)
        .orderBy(desc(estimatedWatchSeconds), asc(history.channelTitle))
        .limit(safeLimit)
        .all();
    },

    dailyActivity(start, endExclusive) {
      return db
        .select({
          day: utcDayExpression,
          videosWatched: count(),
          totalViews: sql<number>`coalesce(sum(${history.viewCount}), 0)`,
          estimatedWatchSeconds: sql<number>`coalesce(sum(${history.durationSeconds} * ${history.viewCount}), 0)`,
        })
        .from(history)
        .where(and(gte(history.lastViewedAt, start), lt(history.lastViewedAt, endExclusive)))
        .groupBy(utcDayExpression)
        .orderBy(asc(utcDayExpression))
        .all();
    },

    activeDays() {
      return db
        .selectDistinct({ day: utcDayExpression })
        .from(history)
        .orderBy(desc(utcDayExpression))
        .all()
        .map((row) => row.day);
    },
  };
}
