/**
 * Human-readable watch-time formatting for the stats page (T85).
 *
 * Kept as a pure helper rather than inline JSX so the estimate card, the
 * channel rows and the heatmap tooltip all render the same string. Like
 * `src/shared/format.ts` it never reads the locale and never throws.
 */

/**
 * Formats a number of seconds as a compact duration.
 *
 * - `0` -> `"0m"`, `45` -> `"45s"`, `90` -> `"1m"`, `3_600` -> `"1h"`.
 * - `5_400` -> `"1h 30m"`, `172_800` -> `"48h"`.
 * - Fractional seconds are rounded; negative, `NaN` and infinite values return
 *   `null` so the caller can omit the value rather than render nonsense.
 */
export function formatWatchTime(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  const totalSeconds = Math.round(seconds);

  if (totalSeconds === 0) {
    return "0m";
  }

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
