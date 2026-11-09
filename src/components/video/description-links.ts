/**
 * Safe link splitting for a plain-text video description.
 *
 * The description is rendered as text, never HTML. The only markup we ever
 * produce is an anchor for an absolute `http`/`https` URL, and every candidate
 * is re-parsed with `URL` before it becomes a link, so other schemes
 * (`javascript:`, `data:`, `file:` ...) can never reach an `href`.
 */

export type DescriptionSegment =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "link"; readonly text: string; readonly href: string };

/** A URL candidate: only the two schemes we are willing to link to. */
const URL_CANDIDATE = /\bhttps?:\/\/[^\s<>"']+/gi;

/** Punctuation that commonly trails a URL in prose. */
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "'", '"']);

/** Closing brackets are only stripped while they are unbalanced. */
const BRACKET_PAIRS: Readonly<Record<string, string>> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

/**
 * Splits `text` into plain-text and link segments, preserving every character
 * of the original string (including line breaks and unsupported URLs).
 */
export function splitDescriptionLinks(text: string): DescriptionSegment[] {
  const segments: DescriptionSegment[] = [];
  const pattern = new RegExp(URL_CANDIDATE.source, URL_CANDIDATE.flags);
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const linkText = trimTrailingPunctuation(match[0]);
    const href = toSafeHref(linkText);

    if (href === null) {
      // Not a usable URL: leave the whole match in the surrounding text.
      continue;
    }

    if (match.index > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, match.index) });
    }

    segments.push({ type: "link", text: linkText, href });

    // Continue right after the untrimmed match, so trailing punctuation is
    // re-emitted as text instead of being swallowed by the link.
    cursor = match.index + linkText.length;
    pattern.lastIndex = cursor;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }

  return segments;
}

/**
 * Parses a candidate and returns its normalized `href`, or `null` when it is
 * malformed or uses a scheme we refuse to link. Defence in depth: the regex
 * already restricts the scheme, and this re-checks the parsed protocol.
 */
function toSafeHref(candidate: string): string | null {
  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

/**
 * Drops sentence punctuation and unbalanced closing brackets from the end of a
 * matched URL. `"https://example.com/a_(b)"` keeps its balanced `)`, while
 * `"(see https://example.com)"` loses the outer one.
 */
function trimTrailingPunctuation(value: string): string {
  let end = value.length;

  while (end > 0) {
    const character = value[end - 1];

    if (TRAILING_PUNCTUATION.has(character)) {
      end -= 1;
      continue;
    }

    const opening = BRACKET_PAIRS[character];
    if (opening !== undefined) {
      const prefix = value.slice(0, end);
      if (countOccurrences(prefix, character) > countOccurrences(prefix, opening)) {
        end -= 1;
        continue;
      }
    }

    break;
  }

  return value.slice(0, end);
}

function countOccurrences(value: string, character: string): number {
  let count = 0;

  for (const current of value) {
    if (current === character) {
      count += 1;
    }
  }

  return count;
}
