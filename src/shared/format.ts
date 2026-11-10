/**
 * Pure, framework-free display formatters.
 *
 * These helpers never touch `Intl` or the ambient locale: the same input always
 * produces the same string on every machine, which keeps server-rendered markup
 * stable and makes the output trivial to unit test. They are presentational only
 * and never throw; unusable input degrades to `null` so callers can omit a field.
 */

/** Number of seconds in a minute and an hour, named for readability below. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;

/**
 * Formats a duration as `m:ss`, or `h:mm:ss` once it reaches an hour.
 *
 * - `3723` -> `"1:02:03"`, `83` -> `"1:23"`, `0` -> `"0:00"`.
 * - Minutes and seconds under an hour are not zero-padded past their natural
 *   width; minutes and seconds after an hour are (`"1:02:03"`, not `"1:2:3"`).
 * - Fractional seconds are floored; negative, `NaN` and infinite values return
 *   `null` because they are not renderable durations.
 */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const remainingSeconds = totalSeconds % SECONDS_PER_MINUTE;
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");

  if (hours === 0) {
    return `${minutes}:${paddedSeconds}`;
  }

  return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
}

/** Ordered from largest to smallest so a count is rendered in its widest unit. */
const COMPACT_UNITS = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
] as const;

/**
 * Formats a non-negative count in compact English units, without a noun.
 *
 * - `999` -> `"999"`, `1200` -> `"1.2K"`, `1500000` -> `"1.5M"`, `1` -> `"1"`.
 * - Fractional counts are floored; negative, `NaN` and infinite values return
 *   `null` so the caller can omit the number.
 *
 * Comment like counts and reply counts reuse this instead of appending a noun
 * that only fits view counts.
 */
export function formatCount(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count < 0) {
    return null;
  }

  const value = Math.floor(count);
  return value < COMPACT_UNITS[COMPACT_UNITS.length - 1].threshold
    ? String(value)
    : formatCompact(value);
}

/**
 * Formats a view count in compact English units.
 *
 * - `999` -> `"999 views"`, `1200` -> `"1.2K views"`, `1500000` -> `"1.5M views"`.
 * - `1` uses the singular `"1 view"`.
 * - Values are rounded to one decimal place, trailing `.0` is dropped, and a
 *   value that would round up to `1000K` is promoted to the next unit instead.
 * - Fractional counts are floored; negative, `NaN` and infinite values return
 *   `null` so the caller can omit the line.
 */
export function formatViewCount(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count < 0) {
    return null;
  }

  const views = Math.floor(count);
  return `${formatCount(views)} ${views === 1 ? "view" : "views"}`;
}

/**
 * Picks the largest unit that fits and formats the scaled value.
 *
 * The scaled value is rounded before the unit is committed, so `999999` becomes
 * `"1M"` rather than the misleading `"1000K"`.
 */
function formatCompact(value: number): string {
  for (let index = 0; index < COMPACT_UNITS.length; index += 1) {
    const unit = COMPACT_UNITS[index];
    if (value < unit.threshold) {
      continue;
    }

    const scaled = roundToOneDecimal(value / unit.threshold);

    // Rounding crossed into the next unit, e.g. 999_999 -> 1000K. Promote it.
    if (scaled >= 1000 && index > 0) {
      const largerUnit = COMPACT_UNITS[index - 1];
      return `${formatTenths(value / largerUnit.threshold)}${largerUnit.suffix}`;
    }

    return `${formatTenths(value / unit.threshold)}${unit.suffix}`;
  }

  return String(value);
}

/** Rounds to one decimal place without depending on `toFixed` or the locale. */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Renders a number with at most one decimal place using integer arithmetic, so
 * the separator is always `.` and no locale-aware formatting can creep in.
 */
function formatTenths(value: number): string {
  const tenths = Math.round(value * 10);
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10;

  return fraction === 0 ? String(whole) : `${whole}.${fraction}`;
}
