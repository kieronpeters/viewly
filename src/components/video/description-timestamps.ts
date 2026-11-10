/**
 * Safe timestamp splicing and chapter extraction for a plain-text description.
 *
 * The description is still rendered as text, never HTML. This module only adds
 * one new kind of token — a `m:ss` or `h:mm:ss` timestamp — next to the safe
 * `http`/`https` links from `description-links.ts`. Timestamps inside a URL are
 * never picked up, because the text is first split by {@link splitDescriptionLinks}
 * and only the plain-text segments are scanned.
 *
 * Everything here is pure and deterministic: no `Date`, no locale, no DOM.
 */

import { formatDuration } from "@/shared/format";

import { splitDescriptionLinks, type DescriptionSegment } from "./description-links";

/** A plain-text description split into text, safe links and timestamps. */
export type DescriptionToken =
  | DescriptionSegment
  | { readonly type: "timestamp"; readonly text: string; readonly seconds: number };

/** One entry of the Chapters list. */
export interface DescriptionChapter {
  /** Second the chapter starts at, as parsed from the description. */
  readonly seconds: number;
  /** Canonical `m:ss` / `h:mm:ss` label, independent of padding in the source. */
  readonly timestamp: string;
  /** Text that follows the timestamp on its line; `""` when there is none. */
  readonly title: string;
}

/**
 * How many distinct timestamps a description needs before the Chapters list is
 * worth showing. One timestamp is just a link in prose; two is a structure.
 */
export const MINIMUM_CHAPTER_COUNT = 2;

/**
 * `m:ss` or `h:mm:ss`. Minutes may run past 59 (`90:00` is a real timestamp in
 * a long video), while seconds and the minutes after an hour are always two
 * digits under 60.
 *
 * The candidate is deliberately permissive; {@link isTimestampBoundary} rejects
 * the matches that are really clock times, version numbers or part of a longer
 * colon chain.
 */
const TIMESTAMP_CANDIDATE = /\d{1,3}:[0-5]\d(?::[0-5]\d)?/g;

/**
 * ASCII word characters, digits and colon characters that make a neighbouring
 * timestamp a false positive. Unicode letters are intentionally not included:
 * `0:00イントロ` is a normal chapter line in CJK prose.
 */
const FORBIDDEN_BEFORE = /[0-9A-Za-z:/._]/;
const FORBIDDEN_AFTER = /[0-9A-Za-z:]/;

/** Leading separators stripped from a chapter title, e.g. `0:00 - Intro`. */
const LEADING_SEPARATOR = /^[\s\-–—:|·•]+/u;

/** Trailing separators stripped from a chapter title, e.g. `0:00 Intro —`. */
const TRAILING_SEPARATOR = /[\s\-–—:|·•]+$/u;

interface TimestampMatch {
  readonly index: number;
  /** Exactly the slice of the source that matched, so it can be re-emitted. */
  readonly text: string;
  readonly seconds: number;
}

/**
 * Splits `text` into plain-text, link and timestamp tokens, preserving every
 * character of the original string.
 */
export function splitDescription(text: string): DescriptionToken[] {
  const tokens: DescriptionToken[] = [];

  for (const segment of splitDescriptionLinks(text)) {
    if (segment.type === "link") {
      tokens.push(segment);
      continue;
    }

    tokens.push(...splitTimestamps(segment.text));
  }

  return tokens;
}

/**
 * Collects one chapter per distinct timestamp, ordered by time.
 *
 * A chapter title is the remainder of the timestamp's own line, so the usual
 * `0:00 Intro` / `12:34 - Demo` blocks work, and a timestamp standing alone on
 * a line still becomes an entry with an empty title. Repeated timestamps keep
 * the first occurrence; a title that runs into the next timestamp on the same
 * line is cut there instead of swallowing it.
 *
 * Timestamps inside a linkified URL (`https://example.com/watch?t=1:02`) are
 * ignored, because the URL is never chapter-like text.
 */
export function extractChapters(text: string): DescriptionChapter[] {
  const linkSpans = collectLinkSpans(text);
  const matches = findTimestamps(text).filter(
    (match) => !linkSpans.some((span) => overlaps(match, span)),
  );
  const chapters: DescriptionChapter[] = [];
  const seen = new Set<number>();

  matches.forEach((match, position) => {
    if (seen.has(match.seconds)) {
      return;
    }

    seen.add(match.seconds);

    const lineEnd = lineEndOf(text, match.index);
    const next = matches[position + 1];
    const titleEnd = next !== undefined && next.index < lineEnd ? next.index : lineEnd;
    const title = text
      .slice(match.index + match.text.length, titleEnd)
      .replace(LEADING_SEPARATOR, "")
      .replace(TRAILING_SEPARATOR, "");

    chapters.push({
      seconds: match.seconds,
      timestamp: formatTimestamp(match.seconds),
      title,
    });
  });

  // `Array.prototype.sort` is stable, so equal timestamps keep document order.
  return chapters.sort((left, right) => left.seconds - right.seconds);
}

/** Splits one plain-text segment on valid timestamps. */
function splitTimestamps(text: string): DescriptionToken[] {
  const tokens: DescriptionToken[] = [];
  let cursor = 0;

  for (const match of findTimestamps(text)) {
    if (match.index > cursor) {
      tokens.push({ type: "text", text: text.slice(cursor, match.index) });
    }

    tokens.push({ type: "timestamp", text: match.text, seconds: match.seconds });
    cursor = match.index + match.text.length;
  }

  if (cursor < text.length) {
    tokens.push({ type: "text", text: text.slice(cursor) });
  }

  return tokens;
}

/** Fresh regular expression per call, so no `lastIndex` state can leak. */
function findTimestamps(text: string): TimestampMatch[] {
  const pattern = new RegExp(TIMESTAMP_CANDIDATE.source, TIMESTAMP_CANDIDATE.flags);
  const matches: TimestampMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (!isTimestampBoundary(text, match.index, match[0].length)) {
      continue;
    }

    matches.push({
      index: match.index,
      text: match[0],
      seconds: toSeconds(match[0]),
    });
  }

  return matches;
}

/**
 * Rejects a candidate that sits inside a longer number, a clock time or a colon
 * chain: `12:345`, `5:00pm`, `1:02:03:04`, `v1:20` and `1.02:30` are not
 * timestamps. The characters around a real timestamp are punctuation or space.
 */
function isTimestampBoundary(text: string, index: number, length: number): boolean {
  const before = index === 0 ? "" : text[index - 1];
  const after = text[index + length] ?? "";

  if (before !== "" && FORBIDDEN_BEFORE.test(before)) {
    return false;
  }

  return !(after !== "" && FORBIDDEN_AFTER.test(after));
}

/** `m:ss` -> seconds, `h:mm:ss` -> seconds. Bounds are guaranteed by the regex. */
function toSeconds(value: string): number {
  const parts = value.split(":").map(Number);

  if (parts.length === 3) {
    return parts[0] * 3_600 + parts[1] * 60 + parts[2];
  }

  return parts[0] * 60 + parts[1];
}

/**
 * Canonical label for a parsed timestamp. `formatDuration` already produces the
 * exact `m:ss` / `h:mm:ss` shape the page uses elsewhere, so chapters, resume
 * prompts and durations always read the same way.
 */
function formatTimestamp(seconds: number): string {
  return formatDuration(seconds) ?? String(seconds);
}

/** Global start/end offsets of every link segment in `text`. */
function collectLinkSpans(text: string): { readonly start: number; readonly end: number }[] {
  const spans: { readonly start: number; readonly end: number }[] = [];
  let offset = 0;

  for (const segment of splitDescriptionLinks(text)) {
    if (segment.type === "link") {
      spans.push({ start: offset, end: offset + segment.text.length });
    }

    offset += segment.text.length;
  }

  return spans;
}

function overlaps(
  match: { readonly index: number; readonly text: string },
  span: { readonly start: number; readonly end: number },
): boolean {
  const start = match.index;
  const end = start + match.text.length;

  return start < span.end && end > span.start;
}

/** End offset of the line that contains `index`. */
function lineEndOf(text: string, index: number): number {
  const lf = text.indexOf("\n", index);
  const cr = text.indexOf("\r", index);
  const ends = [lf, cr].filter((candidate) => candidate !== -1);

  return ends.length === 0 ? text.length : Math.min(...ends);
}
