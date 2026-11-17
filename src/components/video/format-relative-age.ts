/**
 * Deterministic relative age for cards ("2d ago", "3w ago").
 *
 * Watch metadata already formats absolute dates; cards use a compact age, like
 * the observed surface. The caller may pass `now` so a server render and its
 * tests agree on the reference point instead of reading the clock twice.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeAge(publishedAt: string, now: number = Date.now()): string | null {
  const published = Date.parse(publishedAt);

  if (Number.isNaN(published)) {
    return null;
  }

  const seconds = Math.max(0, Math.floor((now - published) / 1000));

  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d ago`;
  if (seconds < MONTH) return `${Math.floor(seconds / WEEK)}w ago`;
  if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo ago`;
  return `${Math.floor(seconds / YEAR)}y ago`;
}
