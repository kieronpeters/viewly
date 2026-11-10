/**
 * Public entry point for the watch-stats feature (T85).
 *
 * This barrel re-exports a `server-only` module, so **Client Components must
 * not import it**. `formatWatchTime` is the only client-safe helper and lives in
 * its own module; import that file directly from client code if needed.
 */
export {
  buildWatchHeatmap,
  computeCurrentStreak,
  DAY_MS,
  DAYS_PER_WEEK,
  getWatchStats,
  HEATMAP_DAYS,
  HEATMAP_WEEKS,
  startOfUtcDay,
  STREAK_GRACE_DAYS,
  utcDayKey,
} from "./watch-stats";
export type { WatchHeatmap, WatchHeatmapDay, WatchStats } from "./watch-stats";
export { formatWatchTime } from "./format-watch-time";
export type {
  ChannelWatchStat,
  DailyWatchStat,
  StatsRepository,
  WatchTotals,
} from "@/lib/db/repositories/stats.repository";
