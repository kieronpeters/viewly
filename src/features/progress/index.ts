/**
 * Public entry point for local playback progress (T68).
 *
 * This barrel re-exports the server-only reads, so **Client Components must not
 * import it**: importing anything here evaluates `progress-data.ts` and with it
 * the `server-only` guard. Client code imports the pure helpers from
 * `./progress` directly and the actions from `./actions`.
 */
export { getVideoProgress, listVideoProgress } from "./progress-data";
export {
  COMPLETE_RATIO,
  PROGRESS_REPORT_INTERVAL_MS,
  RESUME_MIN_RATIO,
  isProgressComplete,
  isResumableProgress,
  parsePlaybackPosition,
  parsePlaybackProgress,
  progressFraction,
  progressFromRow,
  progressPercent,
  shouldReportProgress,
} from "./progress";
export type { PlaybackPosition, VideoProgress } from "./progress";
