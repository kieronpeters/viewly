import "server-only";

/**
 * Server-only watch-stats feature (T85).
 *
 * ## Pipeline
 *
 * `getWatchStats` asks {@link StatsRepository} for grouped counts and then does
 * only presentation work here: filling the 84-day heatmap grid, choosing a
 * relative intensity, and computing the current streak from the list of active
 * days. **No SQL lives in this module.**
 *
 * ## Metric definitions
 *
 * - **Videos watched**: distinct videos in local history (`COUNT(*)`).
 * - **Total views**: `SUM(view_count)`, so a video watched three times counts
 *   three views but one watched video.
 * - **Total watch time** (estimate): `SUM(duration_seconds * view_count)` over
 *   the stored history snapshots. Rows with an unknown duration are excluded
 *   and surfaced as `totals.videosMissingDuration`. The UI must label this as an
 *   estimate; it is not measured playback time.
 * - **Top channels**: grouped by the stored `channel_title`, ordered by
 *   estimated watch time, then channel name for a stable tie-break.
 * - **Current streak**: consecutive UTC calendar days with at least one view,
 *   counting back from the most recent active day. The streak stays "current"
 *   when that day is today *or* yesterday (`STREAK_GRACE_DAYS`), so an evening
 *   routine does not show zero before the user watches something today. If the
 *   latest view is older than the grace day, the streak is `0`.
 * - **Heatmap**: the last {@link HEATMAP_WEEKS} weeks (84 UTC days, today last),
 *   with each day's estimated time. Intensity is *relative* to the busiest day
 *   in the window, not an absolute scale.
 *
 * ## Estimation caveat
 *
 * History stores one row per video, not per playback. A video's estimated time
 * is attributed entirely to the UTC day of its most recent view; repeat views
 * on earlier days are not separately timestamped. This is the same limitation
 * documented in `stats.repository.ts`.
 */

import { getDb } from "@/lib/db/client";
import {
  createStatsRepository,
  type ChannelWatchStat,
  type DailyWatchStat,
  type WatchTotals,
} from "@/lib/db/repositories/stats.repository";

/** Number of week columns in the heatmap. */
export const HEATMAP_WEEKS = 12;

/** Seven days per heatmap column. */
export const DAYS_PER_WEEK = 7;

/** Total heatmap cells: 12 full weeks. */
export const HEATMAP_DAYS = HEATMAP_WEEKS * DAYS_PER_WEEK;

/** One day of the heatmap, after gaps have been filled. */
export interface WatchHeatmapDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Estimated time attributed to this day. */
  estimatedWatchSeconds: number;
  /** Videos whose last view was on this day. */
  videosWatched: number;
  /** Sum of those videos' local view counters. */
  totalViews: number;
  /** Relative intensity bucket; `0` means no recorded activity. */
  level: 0 | 1 | 2 | 3 | 4;
}

/** The complete 12-week heatmap. */
export interface WatchHeatmap {
  /** Oldest week first; each inner array is seven consecutive days. */
  weeks: WatchHeatmapDay[][];
  /** Flattened cells, oldest day first, today last. */
  days: WatchHeatmapDay[];
  /** Busiest day in the window, used for the relative intensity scale. */
  maxEstimatedSeconds: number;
  /** Number of days in the window with any estimated time. */
  activeDayCount: number;
  /** Total estimated seconds inside the window. */
  estimatedWatchSeconds: number;
}

/** Everything the stats page renders. */
export interface WatchStats {
  totals: WatchTotals;
  topChannels: ChannelWatchStat[];
  currentStreakDays: number;
  heatmap: WatchHeatmap;
}

/** Milliseconds in one UTC day; no daylight-saving shift in UTC. */
export const DAY_MS = 24 * 60 * 60 * 1_000;

/** Days of grace before the current streak is considered broken. */
export const STREAK_GRACE_DAYS = 1;

/** Formats a `Date` as its UTC calendar day, `YYYY-MM-DD`. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns midnight UTC of the day containing `date`. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Parses a `YYYY-MM-DD` day into its UTC-midnight timestamp, or `null`. */
function parseUtcDay(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }

  const time = Date.parse(`${day}T00:00:00.000Z`);

  return Number.isNaN(time) ? null : time;
}

/**
 * Counts the current run of consecutive active UTC days.
 *
 * `activeDays` may be unsorted or contain duplicates; it is normalised here so
 * the function is safe to unit-test with hand-written fixtures. Returns `0`
 * when there is no activity, when the latest day is in the future, or when it
 * is more than {@link STREAK_GRACE_DAYS} before `now`.
 */
export function computeCurrentStreak(activeDays: readonly string[], now: Date): number {
  const entries = [...new Set(activeDays)]
    .map((day) => ({ day, time: parseUtcDay(day) }))
    .filter((entry): entry is { day: string; time: number } => entry.time !== null)
    .sort((left, right) => right.time - left.time);

  const latest = entries[0];

  if (latest === undefined) {
    return 0;
  }

  const today = startOfUtcDay(now).getTime();
  const daysSinceLatest = Math.round((today - latest.time) / DAY_MS);

  // A latest day in the future is bad data, not an active streak.
  if (daysSinceLatest < 0 || daysSinceLatest > STREAK_GRACE_DAYS) {
    return 0;
  }

  let streak = 1;

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];

    if (previous === undefined || current === undefined) {
      break;
    }

    // Sorted descending, so a consecutive earlier day is exactly one day away.
    if (Math.round((previous.time - current.time) / DAY_MS) !== 1) {
      break;
    }

    streak += 1;
  }

  return streak;
}

/** Maps estimated seconds to a relative heatmap bucket. */
function intensityLevel(seconds: number, maxSeconds: number): 0 | 1 | 2 | 3 | 4 {
  if (seconds <= 0 || maxSeconds <= 0) {
    return 0;
  }

  const ratio = seconds / maxSeconds;

  if (ratio <= 0.25) {
    return 1;
  }

  if (ratio <= 0.5) {
    return 2;
  }

  if (ratio <= 0.75) {
    return 3;
  }

  return 4;
}

/**
 * Builds the 84-cell heatmap for the 12 weeks ending on `now` (UTC).
 *
 * SQL only returns days with activity, so this fills every missing day with
 * zeroes. The grid is not calendar-week aligned: the first cell is exactly 83
 * days before today, which guarantees 12 full columns and a stable layout.
 */
export function buildWatchHeatmap(
  dailyActivity: readonly DailyWatchStat[],
  now: Date,
): WatchHeatmap {
  const end = startOfUtcDay(now);
  const startTime = end.getTime() - (HEATMAP_DAYS - 1) * DAY_MS;

  const byDay = new Map(dailyActivity.map((row) => [row.day, row]));

  const provisional: Omit<WatchHeatmapDay, "level">[] = [];

  for (let index = 0; index < HEATMAP_DAYS; index += 1) {
    const day = utcDayKey(new Date(startTime + index * DAY_MS));
    const row = byDay.get(day);

    provisional.push({
      day,
      estimatedWatchSeconds: row?.estimatedWatchSeconds ?? 0,
      videosWatched: row?.videosWatched ?? 0,
      totalViews: row?.totalViews ?? 0,
    });
  }

  const maxEstimatedSeconds = provisional.reduce(
    (highest, day) => Math.max(highest, day.estimatedWatchSeconds),
    0,
  );

  const days: WatchHeatmapDay[] = provisional.map((day) => ({
    ...day,
    level: intensityLevel(day.estimatedWatchSeconds, maxEstimatedSeconds),
  }));

  const weeks: WatchHeatmapDay[][] = [];

  for (let index = 0; index < days.length; index += DAYS_PER_WEEK) {
    weeks.push(days.slice(index, index + DAYS_PER_WEEK));
  }

  return {
    weeks,
    days,
    maxEstimatedSeconds,
    activeDayCount: days.filter((day) => day.estimatedWatchSeconds > 0).length,
    estimatedWatchSeconds: days.reduce((total, day) => total + day.estimatedWatchSeconds, 0),
  };
}

/**
 * Reads every metric the stats page needs.
 *
 * `now` is a parameter so the page resolves the clock once, after `io()`, and
 * tests can freeze it. On a fresh install the totals are zero and the three
 * heavier reads (top channels, daily window, active days) are skipped.
 */
export function getWatchStats(now: Date = new Date(), topChannelLimit = 5): WatchStats {
  const repository = createStatsRepository(getDb());
  const totals = repository.totals();

  if (totals.videosWatched === 0) {
    return {
      totals,
      topChannels: [],
      currentStreakDays: 0,
      heatmap: buildWatchHeatmap([], now),
    };
  }

  const today = startOfUtcDay(now);
  const windowStart = new Date(today.getTime() - (HEATMAP_DAYS - 1) * DAY_MS);
  const windowEndExclusive = new Date(today.getTime() + DAY_MS);

  const dailyActivity = repository.dailyActivity(windowStart, windowEndExclusive);
  const activeDays = repository.activeDays();

  return {
    totals,
    topChannels: repository.topChannels(topChannelLimit),
    currentStreakDays: computeCurrentStreak(activeDays, now),
    heatmap: buildWatchHeatmap(dailyActivity, now),
  };
}
