/**
 * Deterministic published-date formatter for the watch details panel.
 *
 * Like `src/shared/format.ts`, this deliberately avoids `Intl` and the ambient
 * locale: the server and the client must render the same string, in UTC, on
 * every machine. Unparseable input degrades to `null` so the caller can omit
 * the row instead of printing "Invalid Date".
 */

/** Short month names, indexed by `Date#getUTCMonth()`. */
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Formats an ISO timestamp as `25 Oct 2009`.
 *
 * The day is not zero-padded, matching the compact style of the rest of the
 * page. Returns `null` for an empty or unparseable timestamp.
 */
export function formatPublishedDate(publishedAt: string): string | null {
  const date = new Date(publishedAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
