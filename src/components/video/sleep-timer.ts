/**
 * Sleep-timer helpers (T82).
 *
 * The timer is a small piece of local UI state: a deadline in milliseconds and
 * a countdown derived from it. Keeping the arithmetic here means the component
 * only owns the interval and the pause request, and the formatting is testable
 * without fake timers or a renderer.
 */

/** Durations offered by the queue's sleep-timer picker, in minutes. */
export const SLEEP_TIMER_OPTIONS_MINUTES = [5, 10, 15, 30, 45, 60] as const;

/** Preselected duration; the shortest option is too abrupt for most viewers. */
export const SLEEP_TIMER_DEFAULT_MINUTES = 15;

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/** Converts a picked duration in minutes to a deadline from `now`. */
export function sleepTimerDeadline(minutes: number, now: number = Date.now()): number {
  return now + Math.max(0, minutes) * MS_PER_MINUTE;
}

/**
 * Whole seconds left until `deadline`.
 *
 * Rounds up so a fresh one-minute timer reads `1:00` rather than `0:59`, and
 * never returns a negative value. An unusable deadline reads as zero.
 */
export function sleepTimerRemainingSeconds(deadline: number, now: number = Date.now()): number {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) {
    return 0;
  }

  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Formats a remaining second count as `m:ss` (or `h:mm:ss` past an hour).
 *
 * Negative and non-finite input is clamped to zero, so the label can never show
 * `-1:-1` in the final tick before the pause request.
 */
export function formatSleepTimerRemaining(seconds: number): string {
  const totalSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainder = totalSeconds % 60;
  const paddedSeconds = String(remainder).padStart(2, "0");

  if (hours === 0) {
    return `${minutes}:${paddedSeconds}`;
  }

  return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
}
