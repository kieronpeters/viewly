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

/** ASCII punctuation that commonly trails a URL in prose. */
const ASCII_TRAILING_PUNCTUATION = [".", ",", ";", ":", "!", "?", "'", '"'];

/**
 * Full-width punctuation that ends a sentence in CJK prose. It is never part
 * of a URL, and leaving it on the candidate lets `URL` fold it into the host
 * through IDNA (`。` and `．` become `.`, `、` becomes `,`).
 */
const FULL_WIDTH_TRAILING_PUNCTUATION = ["、", "。", "，", "．", "！", "？", "：", "；"];

/** Punctuation that commonly trails a URL in prose. */
const TRAILING_PUNCTUATION = new Set([
  ...ASCII_TRAILING_PUNCTUATION,
  ...FULL_WIDTH_TRAILING_PUNCTUATION,
]);

/** Closing brackets are only stripped while they are unbalanced. */
const ASCII_BRACKET_PAIRS: Readonly<Record<string, string>> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

/** Full-width closing brackets, with the opening character they balance. */
const FULL_WIDTH_BRACKET_PAIRS: Readonly<Record<string, string>> = {
  "）": "（",
  "」": "「",
  "】": "【",
  "》": "《",
  "〉": "〈",
  "〕": "〔",
  "］": "［",
  "｝": "｛",
  "〗": "〖",
};

const BRACKET_PAIRS: Readonly<Record<string, string>> = {
  ...ASCII_BRACKET_PAIRS,
  ...FULL_WIDTH_BRACKET_PAIRS,
};

/**
 * Full-width punctuation and brackets must never reach `URL` as part of the
 * authority: IDNA silently rewrites them (`https://example.com、こちら` becomes
 * the host `example.xn--com-6y3b0qwcun`). A candidate is cut at the first one
 * found inside its authority, before parsing, so the host is never re-parsed
 * with punctuation in it. Paths are left alone: a full-width bracket there is
 * percent-encoded instead of truncating the link.
 */
const HOST_TERMINATOR = new RegExp(
  `[${[
    ...FULL_WIDTH_TRAILING_PUNCTUATION,
    ...Object.keys(FULL_WIDTH_BRACKET_PAIRS),
    ...Object.values(FULL_WIDTH_BRACKET_PAIRS),
  ].join("")}]`,
  "u",
);

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
    const linkText = trimTrailingPunctuation(trimHostTerminator(match[0]));
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
 * Cuts a candidate at the first full-width punctuation character inside its
 * authority, so the host is never re-parsed with punctuation folded into it.
 * `"https://example.com、こちら"` becomes `"https://example.com"` and the rest
 * is re-emitted as text; `"https://example.com/a（b）"` is untouched because the
 * bracket sits in the path, not the authority.
 */
function trimHostTerminator(value: string): string {
  const schemeEnd = value.indexOf("://");

  if (schemeEnd === -1) {
    return value;
  }

  const authorityStart = schemeEnd + 3;
  let authorityEnd = value.length;

  for (const delimiter of ["/", "?", "#"]) {
    const index = value.indexOf(delimiter, authorityStart);
    if (index !== -1 && index < authorityEnd) {
      authorityEnd = index;
    }
  }

  const authority = value.slice(authorityStart, authorityEnd);
  const terminator = authority.search(HOST_TERMINATOR);

  return terminator === -1 ? value : value.slice(0, authorityStart + terminator);
}

/**
 * Drops sentence punctuation and unbalanced closing brackets from the end of a
 * matched URL. `"https://example.com/a_(b)"` keeps its balanced `)`, while
 * `"(see https://example.com)"` loses the outer one. Full-width equivalents
 * (`（https://example.com）`, `https://example.com。`) behave the same way.
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
