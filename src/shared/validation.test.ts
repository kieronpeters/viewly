import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  MAX_PAGE_TOKEN_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
  VIDEO_ID_LENGTH,
  assertPageToken,
  assertPlaylistName,
  assertSearchQuery,
  assertVideoId,
  isDomainValidationError,
  isRecord,
  isVideoId,
} from "@/shared/validation";

const VALID_VIDEO_ID = "dQw4w9WgXcQ";

/** Runs a guard that is expected to throw and returns the typed error. */
function caught(run: () => unknown): DomainValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected a DomainValidationError, but the callback returned.");
}

describe("exported bounds", () => {
  it("matches the documented limits", () => {
    expect(VIDEO_ID_LENGTH).toBe(11);
    expect(MAX_SEARCH_QUERY_LENGTH).toBe(100);
    expect(MAX_PLAYLIST_NAME_LENGTH).toBe(60);
    expect(MAX_PAGE_TOKEN_LENGTH).toBe(512);
  });
});

describe("DomainValidationError", () => {
  it("carries a stable code, an optional field and no value", () => {
    const root = new Error("root cause");
    const error = new DomainValidationError("malformed_payload", "Payload is broken.", {
      field: "items",
      cause: root,
    });

    expect(error.name).toBe("DomainValidationError");
    expect(error.code).toBe("malformed_payload");
    expect(error.field).toBe("items");
    expect(error.message).toBe("Payload is broken.");
    expect(error.cause).toBe(root);
    expect(isDomainValidationError(error)).toBe(true);
  });

  it("defaults the field to null and the cause to undefined", () => {
    const error = new DomainValidationError("invalid_type", "Nope.");

    expect(error.field).toBeNull();
    expect(error.cause).toBeUndefined();
  });

  it("narrows only real domain errors", () => {
    expect(isDomainValidationError(new Error("plain"))).toBe(false);
    expect(isDomainValidationError({ code: "invalid_type" })).toBe(false);
    expect(isDomainValidationError(null)).toBe(false);
  });
});

describe("isRecord", () => {
  it("accepts keyed objects, including null-prototype ones", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ items: [] })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it("rejects primitives, arrays, null and functions", () => {
    for (const value of [null, undefined, true, 0, "text", [], [{}], () => ({})]) {
      expect(isRecord(value)).toBe(false);
    }
  });
});

describe("assertSearchQuery", () => {
  it("returns the trimmed query", () => {
    expect(assertSearchQuery("  never gonna give you up  ")).toBe("never gonna give you up");
    expect(assertSearchQuery("\u00a0tabs and newlines\u00a0")).toBe("tabs and newlines");
    expect(assertSearchQuery("lofi  beats 🎧")).toBe("lofi  beats 🎧");
  });

  it("counts length after trimming, not before", () => {
    const padded = `   ${"a".repeat(MAX_SEARCH_QUERY_LENGTH)}   `;

    expect(assertSearchQuery(padded)).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
  });

  it("rejects non-string input", () => {
    for (const value of [undefined, null, 42, true, {}, [], ["query"]]) {
      const error = caught(() => assertSearchQuery(value));

      expect(error.code).toBe("invalid_type");
      expect(error.field).toBe("searchQuery");
    }
  });

  it("rejects empty and whitespace-only queries", () => {
    for (const value of ["", " ", "    ", "\t", "\n", "\r\n", "\u00a0", "\u2003", " \t\n "]) {
      const error = caught(() => assertSearchQuery(value));

      expect(error.code).toBe("empty_value");
      expect(error.field).toBe("searchQuery");
    }
  });

  it("rejects control characters inside the query", () => {
    for (const value of [
      "a\u0000b",
      "a\u0007b",
      "a\nb",
      "a\tb",
      "a\rb",
      "a\u001fb",
      "a\u007fb",
      "a\u0085b",
      "\u0000",
      "query\u008f",
    ]) {
      const error = caught(() => assertSearchQuery(value));

      expect(error.code).toBe("control_characters");
      expect(error.field).toBe("searchQuery");
    }
  });

  it("accepts exactly 100 code points and rejects 101", () => {
    const atLimit = "a".repeat(MAX_SEARCH_QUERY_LENGTH);

    expect(assertSearchQuery(atLimit)).toBe(atLimit);

    const error = caught(() => assertSearchQuery("a".repeat(MAX_SEARCH_QUERY_LENGTH + 1)));
    expect(error.code).toBe("too_long");
  });

  it("counts surrogate pairs as one code point", () => {
    const emoji = "😀";
    expect(emoji).toHaveLength(2);

    const atLimit = emoji.repeat(MAX_SEARCH_QUERY_LENGTH);
    expect(assertSearchQuery(atLimit)).toBe(atLimit);

    const error = caught(() => assertSearchQuery(emoji.repeat(MAX_SEARCH_QUERY_LENGTH + 1)));
    expect(error.code).toBe("too_long");
  });

  it("counts mixed BMP and astral characters by code point", () => {
    // 100 code points but 101 UTF-16 units.
    const atLimit = `${"a".repeat(MAX_SEARCH_QUERY_LENGTH - 1)}😀`;

    expect(assertSearchQuery(atLimit)).toBe(atLimit);
    expect(caught(() => assertSearchQuery(`${atLimit}b`)).code).toBe("too_long");
  });

  it("does not echo the rejected value in the error", () => {
    const error = caught(() => assertSearchQuery("z".repeat(MAX_SEARCH_QUERY_LENGTH + 1)));

    expect(error.message).not.toContain("zzzz");
    expect(error.message).toContain(String(MAX_SEARCH_QUERY_LENGTH));
    expect(error.stack ?? "").not.toContain("zzzzzzzzzz");
  });
});

describe("assertVideoId", () => {
  it("accepts exactly 11 characters from the URL-safe alphabet", () => {
    for (const id of [VALID_VIDEO_ID, "-----------", "___________", "0123456789-", "AZaz09_-AZa"]) {
      expect(assertVideoId(id)).toBe(id);
      expect(isVideoId(id)).toBe(true);
    }
  });

  it("rejects ids that are shorter or longer than 11 characters", () => {
    for (const id of ["", "dQw4w9WgXc", "dQw4w9WgXcQQ", "1234567890", "123456789012"]) {
      const error = caught(() => assertVideoId(id));

      expect(error.code).toBe("invalid_format");
      expect(error.field).toBe("videoId");
    }

    expect(VIDEO_ID_LENGTH).toBe(11);
  });

  it("rejects whitespace padding around an otherwise valid id", () => {
    for (const id of [
      ` ${VALID_VIDEO_ID}`,
      `${VALID_VIDEO_ID} `,
      `${VALID_VIDEO_ID}\n`,
      `\t${VALID_VIDEO_ID}`,
      ` ${VALID_VIDEO_ID} `,
    ]) {
      expect(caught(() => assertVideoId(id)).code).toBe("invalid_format");
    }
  });

  it("rejects characters outside [A-Za-z0-9_-]", () => {
    for (const id of [
      "dQw4w9WgXc!",
      "dQw4w9WgXc.",
      "dQw4w9WgXcé",
      "dQw4w9WgXc=",
      "dQw4w9WgXc+",
      "😀😀😀😀😀😀",
    ]) {
      expect(caught(() => assertVideoId(id)).code).toBe("invalid_format");
    }
  });

  it("rejects non-string input instead of coercing it", () => {
    for (const value of [undefined, null, 12345678901, ["dQw4w9WgXcQ"], { id: VALID_VIDEO_ID }]) {
      const error = caught(() => assertVideoId(value));

      expect(error.code).toBe("invalid_type");
      expect(error.field).toBe("videoId");
    }
  });

  it("mirrors the throwing guard without throwing in isVideoId", () => {
    expect(isVideoId(VALID_VIDEO_ID)).toBe(true);

    for (const value of [null, undefined, 42, "", "short", "dQw4w9WgXcQQ", "dQw4w9WgXc!"]) {
      expect(isVideoId(value)).toBe(false);
    }
  });
});

describe("assertPlaylistName", () => {
  it("returns the trimmed name and preserves internal spacing", () => {
    expect(assertPlaylistName("  Road trip  ")).toBe("Road trip");
    expect(assertPlaylistName("lofi  beats")).toBe("lofi  beats");
    expect(assertPlaylistName("🎵")).toBe("🎵");
  });

  it("rejects non-string input", () => {
    for (const value of [undefined, null, 42, true, {}, []]) {
      const error = caught(() => assertPlaylistName(value));

      expect(error.code).toBe("invalid_type");
      expect(error.field).toBe("playlistName");
    }
  });

  it("rejects empty and whitespace-only names", () => {
    for (const value of ["", " ", "   ", "\t", "\n", "\u00a0"]) {
      const error = caught(() => assertPlaylistName(value));

      expect(error.code).toBe("empty_value");
      expect(error.field).toBe("playlistName");
    }
  });

  it("accepts exactly 60 code points and rejects 61", () => {
    const atLimit = "a".repeat(MAX_PLAYLIST_NAME_LENGTH);

    expect(assertPlaylistName(atLimit)).toBe(atLimit);
    expect(caught(() => assertPlaylistName("a".repeat(MAX_PLAYLIST_NAME_LENGTH + 1))).code).toBe(
      "too_long",
    );
  });

  it("counts surrogate pairs as one code point", () => {
    const atLimit = "🎵".repeat(MAX_PLAYLIST_NAME_LENGTH);

    expect(assertPlaylistName(atLimit)).toBe(atLimit);
    expect(caught(() => assertPlaylistName("🎵".repeat(MAX_PLAYLIST_NAME_LENGTH + 1))).code).toBe(
      "too_long",
    );
  });

  it("counts length after trimming, not before", () => {
    const padded = `  ${"b".repeat(MAX_PLAYLIST_NAME_LENGTH)}  `;

    expect(assertPlaylistName(padded)).toHaveLength(MAX_PLAYLIST_NAME_LENGTH);
  });

  it("does not echo the rejected value in the error", () => {
    const error = caught(() => assertPlaylistName("q".repeat(MAX_PLAYLIST_NAME_LENGTH + 1)));

    expect(error.message).not.toContain("qqqq");
    expect(error.message).toContain(String(MAX_PLAYLIST_NAME_LENGTH));
  });
});

describe("assertPageToken", () => {
  it("normalizes absent and blank tokens to null", () => {
    for (const value of [null, undefined, "", " ", "    ", "\t", "\n", "\u00a0"]) {
      expect(assertPageToken(value)).toBeNull();
    }
  });

  it("accepts base64url characters and padding", () => {
    for (const token of ["CAoQAA", "abc_def-123", "abc=", "a-_=", "AQAAAA=="]) {
      expect(assertPageToken(token)).toBe(token);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(assertPageToken("  CAoQAA\t")).toBe("CAoQAA");
    expect(assertPageToken("\nCAoQAA\r\n")).toBe("CAoQAA");
  });

  it("accepts exactly 512 characters and rejects 513", () => {
    const atLimit = "A".repeat(MAX_PAGE_TOKEN_LENGTH);

    expect(assertPageToken(atLimit)).toBe(atLimit);

    const error = caught(() => assertPageToken("A".repeat(MAX_PAGE_TOKEN_LENGTH + 1)));
    expect(error.code).toBe("too_long");
    expect(error.field).toBe("pageToken");
  });

  it("checks length before the alphabet, so an oversized broken token is too_long", () => {
    expect(caught(() => assertPageToken("+".repeat(MAX_PAGE_TOKEN_LENGTH + 1))).code).toBe(
      "too_long",
    );
  });

  it("rejects internal whitespace and control characters", () => {
    for (const token of [
      "CAo QAA",
      "CAo\tQAA",
      "CAo\nQAA",
      "CAo\rQAA",
      "CAo\u0000QAA",
      "CAo\u007f",
    ]) {
      const error = caught(() => assertPageToken(token));

      expect(error.code).toBe("invalid_format");
      expect(error.field).toBe("pageToken");
    }
  });

  it("rejects characters that are not URL-safe base64url", () => {
    for (const token of ["CAo+QAA", "CAo/QAA", "CAo.QAA", "CAo,QAA", "café", "😀", "CAo QAA="]) {
      expect(caught(() => assertPageToken(token)).code).toBe("invalid_format");
    }
  });

  it("rejects non-string input", () => {
    for (const value of [42, true, {}, [], ["CAoQAA"]]) {
      const error = caught(() => assertPageToken(value));

      expect(error.code).toBe("invalid_type");
      expect(error.field).toBe("pageToken");
    }
  });

  it("does not echo the rejected token in the error", () => {
    const error = caught(() => assertPageToken("t".repeat(MAX_PAGE_TOKEN_LENGTH + 1)));

    expect(error.message).not.toContain("tttt");
    expect(error.message).toContain(String(MAX_PAGE_TOKEN_LENGTH));
  });
});
