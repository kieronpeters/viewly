import { describe, expect, it } from "vitest";

import { DomainValidationError } from "@/shared/validation";
import {
  decodeHtmlEntities,
  normalizeChannelResponse,
  normalizeCommentThreadsResponse,
  normalizePlaylistItemsResponse,
  normalizeSearchResponse,
  normalizeVideoResponse,
  parseIsoDuration,
} from "@/shared/youtube";

const VIDEO_ID = "dQw4w9WgXcQ";
const OTHER_VIDEO_ID = "aaaaaaaaaaa";
const CHANNEL_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";
const FALLBACK_THUMBNAIL = `https://i.ytimg.com/vi/${VIDEO_ID}/mqdefault.jpg`;

/** A snippet shaped like the real `search.list` / `videos.list` snippet. */
function snippet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Never Gonna Give You Up",
    channelId: CHANNEL_ID,
    channelTitle: "Rick Astley",
    publishedAt: "2009-10-25T06:57:33Z",
    thumbnails: {
      high: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
    },
    description: "The official video.",
    ...overrides,
  };
}

/** A `videos.list` item. `id` is a plain string there. */
function videoItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "youtube#video",
    id: VIDEO_ID,
    snippet: snippet(),
    contentDetails: { duration: "PT3M33S" },
    statistics: { viewCount: "1500000000" },
    ...overrides,
  };
}

/** A `search.list` item. `id` is `{ videoId }` there. */
function searchItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "youtube#video",
    id: { kind: "youtube#video", videoId: VIDEO_ID },
    snippet: snippet(),
    ...overrides,
  };
}

function searchPage(
  items: readonly unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "youtube#searchListResponse",
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
    ...extra,
  };
}

function videoPage(items: readonly unknown[]): Record<string, unknown> {
  return { kind: "youtube#videoListResponse", items };
}

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

/** Asserts the payload itself was rejected as malformed. */
function expectMalformed(run: () => unknown, field: string | null = null): void {
  const error = caught(run);

  expect(error.code).toBe("malformed_payload");
  expect(error.field).toBe(field);
}

/** Normalizes a single search item and returns it, or undefined when dropped. */
function onlySearchItem(item: unknown) {
  return normalizeSearchResponse(searchPage([item])).items[0];
}

describe("decodeHtmlEntities", () => {
  it("decodes the named entities YouTube emits", () => {
    expect(decodeHtmlEntities("&amp; &lt; &gt; &quot; &#39; &#x27; &nbsp;")).toBe("& < > \" ' ' ");
  });

  it("decodes decimal and hexadecimal numeric references", () => {
    expect(decodeHtmlEntities("DON&#39;T")).toBe("DON'T");
    expect(decodeHtmlEntities("DON&#x27;T")).toBe("DON'T");
    expect(decodeHtmlEntities("&#8217;")).toBe("\u2019");
    expect(decodeHtmlEntities("&#x1F600;")).toBe("\u{1F600}");
  });

  it("decodes exactly once, even for pre-escaped source", () => {
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;#39;")).toBe("&#39;");
  });

  it("leaves a literal ampersand alone", () => {
    expect(decodeHtmlEntities("Tom & Jerry")).toBe("Tom & Jerry");
    expect(decodeHtmlEntities("R&D & something")).toBe("R&D & something");
  });

  it("leaves unknown or malformed entities untouched", () => {
    for (const value of [
      "&apos;",
      "&copy;",
      "&AMP;",
      "&amp",
      "&amp ;",
      "&#xZZ;",
      "&#;",
      "&#0;",
      "&#xD800;",
      "&#99999999;",
    ]) {
      expect(decodeHtmlEntities(value)).toBe(value);
    }
  });

  it("collapses decoded non-breaking spaces to one normal space", () => {
    expect(decodeHtmlEntities("A&nbsp;&nbsp;B")).toBe("A B");
    expect(decodeHtmlEntities("A&#160;&#xa0;B")).toBe("A B");
    expect(decodeHtmlEntities("A &nbsp; B")).toBe("A B");
    expect(decodeHtmlEntities("\u00a0\u00a0")).toBe(" ");
  });

  it("returns blank input unchanged", () => {
    expect(decodeHtmlEntities("")).toBe("");
    expect(decodeHtmlEntities("   ")).toBe("   ");
  });
});

describe("normalizeSearchResponse", () => {
  it("maps a complete search item and leaves snippet-only fields null", () => {
    const page = normalizeSearchResponse(searchPage([searchItem()]));

    expect(page.items).toEqual([
      {
        id: VIDEO_ID,
        title: "Never Gonna Give You Up",
        channelId: CHANNEL_ID,
        channelTitle: "Rick Astley",
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        publishedAt: "2009-10-25T06:57:33Z",
        durationSeconds: null,
        viewCount: null,
      },
    ]);
    expect(page.nextPageToken).toBeNull();
    expect(page.totalResults).toBe(1);
  });

  it("returns an empty page for an empty items array", () => {
    expect(normalizeSearchResponse({ items: [] })).toEqual({
      items: [],
      nextPageToken: null,
      totalResults: null,
    });
  });

  it("throws for payloads that are not objects", () => {
    for (const payload of [undefined, null, 42, "response", true, [{ items: [] }]]) {
      expectMalformed(() => normalizeSearchResponse(payload));
    }
  });

  it("throws when items is missing or not an array", () => {
    for (const payload of [
      {},
      { items: null },
      { items: undefined },
      { items: "video" },
      { items: 42 },
      { items: {} },
    ]) {
      expectMalformed(() => normalizeSearchResponse(payload));
    }
  });

  it("drops items that are not objects", () => {
    const page = normalizeSearchResponse(
      searchPage([null, undefined, "video", 42, true, [searchItem()]]),
    );

    expect(page.items).toEqual([]);
  });

  it("drops items without a usable video id", () => {
    for (const item of [
      { snippet: snippet() },
      { id: null, snippet: snippet() },
      { id: {}, snippet: snippet() },
      { id: { kind: "youtube#video" }, snippet: snippet() },
      { id: { videoId: "short" }, snippet: snippet() },
      { id: { videoId: "dQw4w9WgXc!" }, snippet: snippet() },
      { id: "", snippet: snippet() },
      { id: "short", snippet: snippet() },
      { id: 42, snippet: snippet() },
    ]) {
      expect(onlySearchItem(item)).toBeUndefined();
    }
  });

  it("accepts an id supplied as a plain string", () => {
    const summary = onlySearchItem({ id: VIDEO_ID, snippet: snippet() });

    expect(summary?.id).toBe(VIDEO_ID);
  });

  it("drops channel and playlist results even with a valid-looking snippet", () => {
    const channel = {
      kind: "youtube#channel",
      id: { kind: "youtube#channel", channelId: CHANNEL_ID },
      snippet: snippet({ title: "Rick Astley" }),
    };
    const playlist = {
      kind: "youtube#playlist",
      id: { kind: "youtube#playlist", playlistId: "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI" },
      snippet: snippet({ title: "A playlist" }),
    };

    expect(normalizeSearchResponse(searchPage([channel, playlist])).items).toEqual([]);
  });

  it("drops items with a missing or unusable snippet", () => {
    for (const item of [
      { id: { videoId: VIDEO_ID } },
      { id: { videoId: VIDEO_ID }, snippet: null },
      { id: { videoId: VIDEO_ID }, snippet: "snippet" },
      { id: { videoId: VIDEO_ID }, snippet: [] },
    ]) {
      expect(onlySearchItem(item)).toBeUndefined();
    }
  });

  it("drops items with a missing, blank or non-string title", () => {
    for (const title of [undefined, null, "", "   ", "\t\n", 42, true, {}]) {
      const item = searchItem({ snippet: snippet({ title }) });

      expect(onlySearchItem(item)).toBeUndefined();
    }
  });

  it("decodes HTML entities in the title and channel title exactly once", () => {
    const summary = onlySearchItem(
      searchItem({
        snippet: snippet({
          title: "DON&#39;T LET THE HUMANS IN &amp;amp; OUT",
          channelTitle: "Mister &amp; Bbbi",
        }),
      }),
    );

    expect(summary?.title).toBe("DON'T LET THE HUMANS IN &amp; OUT");
    expect(summary?.channelTitle).toBe("Mister & Bbbi");
  });

  it("collapses decoded non-breaking spaces and repeated spaces in a title", () => {
    const summary = onlySearchItem(
      searchItem({ snippet: snippet({ title: "  A&nbsp;&nbsp;B   C  " }) }),
    );

    expect(summary?.title).toBe("A B C");
  });

  it("leaves an unknown entity in a title untouched", () => {
    expect(
      onlySearchItem(searchItem({ snippet: snippet({ title: "Fish &copy; Chips" }) }))?.title,
    ).toBe("Fish &copy; Chips");
  });

  it("trims the title and accepts exactly 300 characters", () => {
    const trimmed = onlySearchItem(searchItem({ snippet: snippet({ title: "  Spaced  " }) }));
    expect(trimmed?.title).toBe("Spaced");

    const atLimit = "a".repeat(300);
    const accepted = onlySearchItem(searchItem({ snippet: snippet({ title: atLimit }) }));
    expect(accepted?.title).toBe(atLimit);

    const dropped = onlySearchItem(searchItem({ snippet: snippet({ title: "a".repeat(301) }) }));
    expect(dropped).toBeUndefined();
  });

  it("drops items with a missing or invalid publishedAt", () => {
    for (const publishedAt of [
      undefined,
      null,
      "",
      "   ",
      "2009-10-25",
      "25/10/2009",
      "not-a-date",
      "2009-13-45T99:99:99Z",
      "2009-10-25T06:57:33",
      1234567890,
    ]) {
      const item = searchItem({ snippet: snippet({ publishedAt }) });

      expect(onlySearchItem(item)).toBeUndefined();
    }
  });

  it("preserves valid timestamps verbatim, including fractions and offsets", () => {
    for (const publishedAt of [
      "2009-10-25T06:57:33Z",
      "2009-10-25T06:57:33.123456789Z",
      "2009-10-25T06:57:33+02:00",
      "2009-10-25T06:57:33-05:30",
    ]) {
      const item = searchItem({ snippet: snippet({ publishedAt }) });

      expect(onlySearchItem(item)?.publishedAt).toBe(publishedAt);
    }
  });

  it("defaults a missing channel to empty strings", () => {
    const summary = onlySearchItem(
      searchItem({ snippet: snippet({ channelId: undefined, channelTitle: undefined }) }),
    );

    expect(summary?.channelId).toBe("");
    expect(summary?.channelTitle).toBe("");
  });

  it("picks the largest https thumbnail", () => {
    const thumbnails = {
      default: { url: "https://img.example/default.jpg" },
      medium: { url: "https://img.example/medium.jpg" },
      high: { url: "https://img.example/high.jpg" },
      standard: { url: "https://img.example/standard.jpg" },
      maxres: { url: "https://img.example/maxres.jpg" },
    };

    const summary = onlySearchItem(searchItem({ snippet: snippet({ thumbnails }) }));

    expect(summary?.thumbnailUrl).toBe("https://img.example/maxres.jpg");
  });

  it("falls through to the next https variant", () => {
    const caseOne = onlySearchItem(
      searchItem({
        snippet: snippet({
          thumbnails: {
            maxres: { url: "http://img.example/maxres.jpg" },
            standard: { url: "https://img.example/standard.jpg" },
            high: { url: "https://img.example/high.jpg" },
          },
        }),
      }),
    );
    expect(caseOne?.thumbnailUrl).toBe("https://img.example/standard.jpg");

    const caseTwo = onlySearchItem(
      searchItem({
        snippet: snippet({
          thumbnails: {
            standard: { url: "https://img.example/standard.jpg" },
            high: { url: "https://img.example/high.jpg" },
          },
        }),
      }),
    );
    expect(caseTwo?.thumbnailUrl).toBe("https://img.example/standard.jpg");
  });

  it("falls back to YouTube's thumbnail endpoint when no https variant is usable", () => {
    const unusable = [
      undefined,
      null,
      "thumbnails",
      [],
      {},
      { maxres: { url: "http://img.example/maxres.jpg" } },
      { maxres: { url: "not a url" } },
      { maxres: { url: "data:image/png;base64,AAAA" } },
      { maxres: { url: "ftp://img.example/maxres.jpg" } },
      { maxres: { url: 42 } },
      { maxres: "https://img.example/maxres.jpg" },
      { maxres: null, high: { url: "//img.example/high.jpg" } },
    ];

    for (const thumbnails of unusable) {
      const summary = onlySearchItem(searchItem({ snippet: snippet({ thumbnails }) }));

      expect(summary?.thumbnailUrl).toBe(FALLBACK_THUMBNAIL);
    }
  });

  it("uses the item's own id in the thumbnail fallback", () => {
    const summary = onlySearchItem(
      searchItem({
        id: { videoId: OTHER_VIDEO_ID },
        snippet: snippet({ thumbnails: undefined }),
      }),
    );

    expect(summary?.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${OTHER_VIDEO_ID}/mqdefault.jpg`);
  });

  it("maps durations and treats zero as a real duration", () => {
    const durations: Array<[string, number | null]> = [
      ["PT3M33S", 213],
      ["PT1H2M3S", 3723],
      ["P1DT2H3M4S", 93784],
      ["P2W", 1209600],
      ["P0D", 0],
      ["PT0S", 0],
      ["PT1.5S", null],
      ["3:33", null],
    ];

    for (const [duration, expected] of durations) {
      const summary = onlySearchItem(searchItem({ contentDetails: { duration } }));

      expect(summary?.durationSeconds).toBe(expected);
    }
  });

  it("returns null duration for missing or non-string contentDetails", () => {
    for (const contentDetails of [
      undefined,
      null,
      "PT3M33S",
      {},
      { duration: 213 },
      { duration: null },
      { duration: "" },
    ]) {
      const summary = onlySearchItem(searchItem({ contentDetails }));

      expect(summary?.durationSeconds).toBeNull();
    }
  });

  it("maps statistics as non-negative integers only", () => {
    const counts: Array<[unknown, number | null]> = [
      ["1500000000", 1500000000],
      [1234, 1234],
      ["0", 0],
      [0, 0],
      [undefined, null],
      ["-1", null],
      [-1, null],
      [1.5, null],
      ["1.5", null],
      ["1e6", null],
      [true, null],
      ["9999999999999999", null],
      [2 ** 53, null],
    ];

    for (const [viewCount, expected] of counts) {
      const summary = onlySearchItem(searchItem({ statistics: { viewCount } }));

      expect(summary?.viewCount).toBe(expected);
    }
  });

  it("returns null statistics when the object is missing or malformed", () => {
    for (const statistics of [undefined, null, "statistics", [], {}]) {
      expect(onlySearchItem(searchItem({ statistics }))?.viewCount).toBeNull();
    }
  });

  it("passes a valid nextPageToken through", () => {
    expect(normalizeSearchResponse(searchPage([], { nextPageToken: "CAoQAA" })).nextPageToken).toBe(
      "CAoQAA",
    );
  });

  it("normalizes absent and blank nextPageTokens to null", () => {
    for (const nextPageToken of [undefined, null, "", "   ", "\t\n"]) {
      expect(normalizeSearchResponse(searchPage([], { nextPageToken })).nextPageToken).toBeNull();
    }
  });

  it("rejects a non-string nextPageToken as a malformed payload", () => {
    for (const nextPageToken of [42, true, {}, []]) {
      expectMalformed(
        () => normalizeSearchResponse(searchPage([], { nextPageToken })),
        "nextPageToken",
      );
    }
  });

  it("rejects hostile nextPageTokens with the shared token rules", () => {
    const tooLong = caught(() =>
      normalizeSearchResponse(searchPage([], { nextPageToken: "A".repeat(513) })),
    );
    expect(tooLong.code).toBe("too_long");
    expect(tooLong.field).toBe("pageToken");

    const invalid = caught(() =>
      normalizeSearchResponse(searchPage([], { nextPageToken: "CAo QAA" })),
    );
    expect(invalid.code).toBe("invalid_format");
    expect(invalid.field).toBe("pageToken");
  });

  it("maps totalResults from numbers and decimal strings only", () => {
    const totals: Array<[unknown, number | null]> = [
      [0, 0],
      [42, 42],
      ["0", 0],
      ["42", 42],
      ["-1", null],
      [-1, null],
      [1.5, null],
      ["1.5", null],
      ["abc", null],
      [true, null],
      ["9999999999999999", null],
      [2 ** 53, null],
    ];

    for (const [totalResults, expected] of totals) {
      const page = normalizeSearchResponse(searchPage([], { pageInfo: { totalResults } }));

      expect(page.totalResults).toBe(expected);
    }
  });

  it("returns null totalResults when pageInfo is missing or malformed", () => {
    for (const pageInfo of [undefined, null, "pageInfo", [], {}]) {
      expect(normalizeSearchResponse({ items: [], pageInfo }).totalResults).toBeNull();
    }
  });

  it("ignores prototype-pollution keys without touching Object.prototype", () => {
    const payload: unknown = JSON.parse(`{
      "__proto__": { "polluted": true },
      "constructor": { "prototype": { "polluted": true } },
      "items": [
        {
          "__proto__": { "polluted": true },
          "id": { "videoId": "${VIDEO_ID}", "__proto__": { "polluted": true } },
          "snippet": {
            "__proto__": { "polluted": true },
            "title": "Safe title",
            "channelId": "${CHANNEL_ID}",
            "channelTitle": "Channel",
            "publishedAt": "2024-01-01T00:00:00Z",
            "thumbnails": { "__proto__": { "url": "https://evil.example/x.jpg" } }
          }
        }
      ]
    }`);

    const page = normalizeSearchResponse(payload);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.title).toBe("Safe title");
    expect(page.items[0]?.thumbnailUrl).toBe(FALLBACK_THUMBNAIL);
    expect(page.items[0]).not.toHaveProperty("polluted");
    expect({} as Record<string, unknown>).not.toHaveProperty("polluted");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});

describe("normalizeVideoResponse", () => {
  it("maps a complete video with its description", () => {
    const detail = normalizeVideoResponse(videoPage([videoItem()]));

    expect(detail).toEqual({
      id: VIDEO_ID,
      title: "Never Gonna Give You Up",
      channelId: CHANNEL_ID,
      channelTitle: "Rick Astley",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      publishedAt: "2009-10-25T06:57:33Z",
      durationSeconds: 213,
      viewCount: 1500000000,
      description: "The official video.",
    });
  });

  it("returns null for an empty items array", () => {
    expect(normalizeVideoResponse(videoPage([]))).toBeNull();
  });

  it("throws for payloads that are not objects", () => {
    for (const payload of [undefined, null, 42, "response", true, [videoItem()]]) {
      expectMalformed(() => normalizeVideoResponse(payload));
    }
  });

  it("throws when items is missing or not an array", () => {
    for (const payload of [{}, { items: null }, { items: "video" }, { items: 42 }, { items: {} }]) {
      expectMalformed(() => normalizeVideoResponse(payload));
    }
  });

  it("returns the first usable item and skips malformed ones", () => {
    const detail = normalizeVideoResponse(
      videoPage([
        null,
        "video",
        videoItem({ id: "short" }),
        videoItem(),
        videoItem({ id: OTHER_VIDEO_ID }),
      ]),
    );

    expect(detail?.id).toBe(VIDEO_ID);
  });

  it("accepts an id object even though videos.list normally sends a string", () => {
    const detail = normalizeVideoResponse(videoPage([videoItem({ id: { videoId: VIDEO_ID } })]));

    expect(detail?.id).toBe(VIDEO_ID);
  });

  it("returns null when no item has a usable id", () => {
    for (const id of [undefined, null, "", "short", 42, {}, { videoId: "short" }]) {
      expect(normalizeVideoResponse(videoPage([videoItem({ id })]))).toBeNull();
    }
  });

  it("returns null when the snippet or timestamp is unusable", () => {
    for (const item of [
      videoItem({ snippet: undefined }),
      videoItem({ snippet: null }),
      videoItem({ snippet: "snippet" }),
      videoItem({ snippet: snippet({ title: "   " }) }),
      videoItem({ snippet: snippet({ publishedAt: "2009-10-25" }) }),
    ]) {
      expect(normalizeVideoResponse(videoPage([item]))).toBeNull();
    }
  });

  it("defaults a missing or non-string description to an empty string", () => {
    for (const description of [undefined, null, 42, {}, []]) {
      const detail = normalizeVideoResponse(
        videoPage([videoItem({ snippet: snippet({ description }) })]),
      );

      expect(detail?.description).toBe("");
    }
  });

  it("decodes entities in the title, channel title and description once", () => {
    const detail = normalizeVideoResponse(
      videoPage([
        videoItem({
          snippet: snippet({
            title: "Mister &amp; Bbbi",
            channelTitle: "Mister &amp;amp; Bbbi",
            description: "Line &quot;one&quot;&nbsp;&nbsp;line two",
          }),
        }),
      ]),
    );

    expect(detail?.title).toBe("Mister & Bbbi");
    expect(detail?.channelTitle).toBe("Mister &amp; Bbbi");
    expect(detail?.description).toBe('Line "one" line two');
  });

  it("keeps a literal ampersand and an unknown entity in a description", () => {
    const detail = normalizeVideoResponse(
      videoPage([
        videoItem({
          snippet: snippet({ description: "Tom & Jerry &copy; 2026" }),
        }),
      ]),
    );

    expect(detail?.description).toBe("Tom & Jerry &copy; 2026");
  });

  it("keeps a description that is present", () => {
    const detail = normalizeVideoResponse(
      videoPage([videoItem({ snippet: snippet({ description: "  line one\nline two  " }) })]),
    );

    expect(detail?.description).toBe("  line one\nline two  ");
  });

  it("returns null duration and view count when those parts are absent", () => {
    const detail = normalizeVideoResponse(
      videoPage([videoItem({ contentDetails: undefined, statistics: undefined })]),
    );

    expect(detail?.durationSeconds).toBeNull();
    expect(detail?.viewCount).toBeNull();
  });

  it("falls back to the YouTube thumbnail endpoint for non-https thumbnails", () => {
    const detail = normalizeVideoResponse(
      videoPage([
        videoItem({
          snippet: snippet({ thumbnails: { maxres: { url: "http://img.example/maxres.jpg" } } }),
        }),
      ]),
    );

    expect(detail?.thumbnailUrl).toBe(FALLBACK_THUMBNAIL);
  });

  it("enforces the 300 character title bound", () => {
    const atLimit = normalizeVideoResponse(
      videoPage([videoItem({ snippet: snippet({ title: "a".repeat(300) }) })]),
    );
    expect(atLimit?.title).toBe("a".repeat(300));

    const overLimit = normalizeVideoResponse(
      videoPage([videoItem({ snippet: snippet({ title: "a".repeat(301) }) })]),
    );
    expect(overLimit).toBeNull();
  });

  it("ignores prototype-pollution keys in a video payload", () => {
    const payload: unknown = JSON.parse(`{
      "__proto__": { "polluted": true },
      "items": [
        {
          "id": "${VIDEO_ID}",
          "snippet": {
            "__proto__": { "polluted": true },
            "title": "Safe title",
            "publishedAt": "2024-01-01T00:00:00Z"
          },
          "statistics": { "__proto__": { "viewCount": "999" } }
        }
      ]
    }`);

    const detail = normalizeVideoResponse(payload);

    expect(detail?.title).toBe("Safe title");
    expect(detail?.viewCount).toBeNull();
    expect(detail).not.toHaveProperty("polluted");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});

describe("parseIsoDuration", () => {
  it("parses the ISO-8601 duration forms YouTube emits", () => {
    const cases: Array<[string, number]> = [
      ["PT0S", 0],
      ["PT59S", 59],
      ["PT1M", 60],
      ["PT1H", 3600],
      ["PT3M33S", 213],
      ["PT1H2M3S", 3723],
      ["P0D", 0],
      ["P1D", 86400],
      ["P1DT2H", 93600],
      ["P1DT2H3M4S", 93784],
      ["P1W", 604800],
      ["P2W", 1209600],
      ["P1W2D", 777600],
    ];

    for (const [value, expected] of cases) {
      expect(parseIsoDuration(value)).toBe(expected);
    }
  });

  it("returns null for values it cannot parse", () => {
    for (const value of [
      "",
      " ",
      "P",
      "PT",
      "P1DT",
      "1H",
      "PT1H2M3S4",
      "-PT1H",
      "PT-1H",
      "PT1.5S",
      "P1D2H",
      "P1Y",
      "P1M",
      "pt1h",
      " PT1H",
      "PT1H ",
      "3:33",
    ]) {
      expect(parseIsoDuration(value)).toBeNull();
    }
  });

  it("returns null instead of an unsafe integer for overflowing durations", () => {
    expect(parseIsoDuration("P99999999999999999999D")).toBeNull();
    expect(parseIsoDuration("PT99999999999999999999H")).toBeNull();
  });
});

/** A snippet shaped like a real `commentThreads.list` top-level comment. */
function commentSnippet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authorDisplayName: "Ada Lovelace",
    textOriginal: "First! Great video.",
    likeCount: 12,
    publishedAt: "2026-01-02T03:04:05Z",
    ...overrides,
  };
}

/** One `commentThread` item, shaped like the real API. */
function commentThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "youtube#commentThread",
    id: "UgxThread",
    snippet: {
      videoId: VIDEO_ID,
      totalReplyCount: 3,
      topLevelComment: {
        kind: "youtube#comment",
        id: "UgxComment",
        snippet: commentSnippet(),
      },
    },
    ...overrides,
  };
}

describe("normalizeCommentThreadsResponse", () => {
  it("maps the top-level comment fields the watch page renders", () => {
    const page = normalizeCommentThreadsResponse({
      kind: "youtube#commentThreadListResponse",
      nextPageToken: "CAoQAA",
      items: [commentThread()],
    });

    expect(page.commentsDisabled).toBe(false);
    expect(page.nextPageToken).toBe("CAoQAA");
    expect(page.items).toEqual([
      {
        id: "UgxComment",
        author: "Ada Lovelace",
        text: "First! Great video.",
        likeCount: 12,
        publishedAt: "2026-01-02T03:04:05Z",
        replyCount: 3,
      },
    ]);
  });

  it("returns an empty page for no comments", () => {
    expect(normalizeCommentThreadsResponse({ items: [] })).toEqual({
      items: [],
      nextPageToken: null,
      commentsDisabled: false,
    });
  });

  it("defaults missing counts and keeps comment text free of markup", () => {
    const page = normalizeCommentThreadsResponse({
      items: [
        commentThread({
          snippet: {
            totalReplyCount: 0,
            topLevelComment: {
              id: "UgxComment",
              snippet: commentSnippet({
                likeCount: undefined,
                textOriginal: undefined,
                textDisplay: '<b>Hello</b> &amp; <a href="https://example.com">welcome</a>',
              }),
            },
          },
        }),
      ],
    });

    expect(page.items[0]).toMatchObject({
      text: "Hello & welcome",
      likeCount: null,
      replyCount: 0,
    });
  });

  it("decodes textOriginal exactly once without stripping it as markup", () => {
    const page = normalizeCommentThreadsResponse({
      items: [
        commentThread({
          snippet: {
            totalReplyCount: 0,
            topLevelComment: {
              id: "UgxComment",
              snippet: commentSnippet({
                textOriginal: "Fish &amp;amp; Chips &lt;3",
              }),
            },
          },
        }),
      ],
    });

    expect(page.items[0]?.text).toBe("Fish &amp; Chips <3");
  });

  it("drops threads without an id, author, body or timestamp", () => {
    const page = normalizeCommentThreadsResponse({
      items: [
        commentThread({ id: undefined, snippet: { totalReplyCount: 0, topLevelComment: {} } }),
        commentThread({ snippet: undefined }),
        commentThread({
          snippet: {
            totalReplyCount: 0,
            topLevelComment: {
              id: "a",
              snippet: commentSnippet({ authorDisplayName: "   " }),
            },
          },
        }),
        commentThread({
          snippet: {
            totalReplyCount: 0,
            topLevelComment: { id: "b", snippet: commentSnippet({ textOriginal: "  " }) },
          },
        }),
        commentThread({
          snippet: {
            totalReplyCount: 0,
            topLevelComment: {
              id: "c",
              snippet: commentSnippet({ publishedAt: "not-a-date" }),
            },
          },
        }),
      ],
    });

    expect(page.items).toEqual([]);
  });

  it("rejects a malformed payload or next page token", () => {
    expectMalformed(() => normalizeCommentThreadsResponse(null));
    expectMalformed(() => normalizeCommentThreadsResponse({ items: "nope" }));
    expectMalformed(
      () => normalizeCommentThreadsResponse({ items: [], nextPageToken: 7 }),
      "nextPageToken",
    );
  });
});

/** A `playlistItems.list` item. The item id is not the video id. */
function playlistItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "youtube#playlistItem",
    id: "PLitem-not-a-video-id",
    snippet: {
      publishedAt: "2026-01-02T03:04:05Z",
      channelId: CHANNEL_ID,
      title: "A recent upload",
      description: "Video description that a card never renders.",
      thumbnails: {
        high: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
      },
      channelTitle: "Rick Astley",
      resourceId: { kind: "youtube#video", videoId: VIDEO_ID },
    },
    contentDetails: {
      videoId: VIDEO_ID,
      videoPublishedAt: "2026-01-02T03:04:05Z",
    },
    ...overrides,
  };
}

function playlistPage(items: readonly unknown[]): Record<string, unknown> {
  return { kind: "youtube#playlistItemListResponse", items };
}

describe("normalizePlaylistItemsResponse", () => {
  it("maps nested video ids, snippet fields and the upload date", () => {
    expect(normalizePlaylistItemsResponse(playlistPage([playlistItem()]))).toEqual([
      {
        id: VIDEO_ID,
        title: "A recent upload",
        channelId: CHANNEL_ID,
        channelTitle: "Rick Astley",
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        publishedAt: "2026-01-02T03:04:05Z",
        // playlistItems.list reports neither duration nor view statistics.
        durationSeconds: null,
        viewCount: null,
      },
    ]);
  });

  it("decodes entities in playlist item and channel titles", () => {
    const video = normalizePlaylistItemsResponse(
      playlistPage([
        playlistItem({
          snippet: {
            publishedAt: "2026-01-02T03:04:05Z",
            channelId: CHANNEL_ID,
            title: "Because you watched Don&#39;t Let The Humans In",
            channelTitle: "Mister &amp; Bbbi",
            resourceId: { kind: "youtube#video", videoId: VIDEO_ID },
          },
        }),
      ]),
    )[0];

    expect(video?.title).toBe("Because you watched Don't Let The Humans In");
    expect(video?.channelTitle).toBe("Mister & Bbbi");
  });

  it("falls back to snippet.resourceId and snippet.publishedAt", () => {
    const item = playlistItem({
      contentDetails: {},
      snippet: {
        publishedAt: "2025-12-31T23:59:59Z",
        channelId: CHANNEL_ID,
        title: "Fallback item",
        channelTitle: "Rick Astley",
        resourceId: { kind: "youtube#video", videoId: OTHER_VIDEO_ID },
      },
    });

    expect(normalizePlaylistItemsResponse(playlistPage([item]))).toMatchObject([
      { id: OTHER_VIDEO_ID, publishedAt: "2025-12-31T23:59:59Z", title: "Fallback item" },
    ]);
  });

  it("returns an empty array for an empty uploads page", () => {
    expect(normalizePlaylistItemsResponse(playlistPage([]))).toEqual([]);
  });

  it("drops items without a usable video id, title or publish date", () => {
    const usable = playlistItem();
    const unusable = [
      null,
      { snippet: null },
      playlistItem({
        contentDetails: {},
        snippet: { title: "No id", publishedAt: "2026-01-01T00:00:00Z" },
      }),
      playlistItem({
        contentDetails: { videoId: "short" },
        snippet: { title: "Short id", publishedAt: "2026-01-01T00:00:00Z" },
      }),
      playlistItem({ snippet: { title: "   ", resourceId: { videoId: VIDEO_ID } } }),
      playlistItem({ contentDetails: { videoId: VIDEO_ID }, snippet: { title: "No date" } }),
    ];

    expect(normalizePlaylistItemsResponse(playlistPage([...unusable, usable]))).toHaveLength(1);
    expect(normalizePlaylistItemsResponse(playlistPage(unusable))).toEqual([]);
  });

  it("throws for payloads that are not playlist responses", () => {
    for (const payload of [undefined, null, 42, "response", [{ items: [] }]]) {
      expectMalformed(() => normalizePlaylistItemsResponse(payload));
    }

    expectMalformed(() => normalizePlaylistItemsResponse({}));
    expectMalformed(() => normalizePlaylistItemsResponse({ items: null }));
  });
});

/** A `channels.list` item shaped like the real API (`part=snippet,statistics,contentDetails`). */
function channelItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "youtube#channel",
    id: CHANNEL_ID,
    snippet: {
      title: "Rick Astley",
      description: "The official Rick Astley channel.",
      customUrl: "@rickastley",
      publishedAt: "2009-10-25T06:57:33Z",
      thumbnails: {
        default: { url: "https://yt3.ggpht.com/channel-default=s88" },
        medium: { url: "https://yt3.ggpht.com/channel-medium=s240" },
        high: { url: "https://yt3.ggpht.com/channel-high=s800" },
      },
    },
    statistics: { viewCount: "1000000", subscriberCount: "4200000", hiddenSubscriberCount: false },
    contentDetails: { relatedPlaylists: { uploads: "UUuAXFkgsw1L7xaCfnd5JJOw" } },
    ...overrides,
  };
}

function channelPage(items: readonly unknown[]): Record<string, unknown> {
  return { kind: "youtube#channelListResponse", items };
}

describe("normalizeChannelResponse", () => {
  it("maps the id, name, largest avatar, subscriber count, description and uploads playlist", () => {
    expect(normalizeChannelResponse(channelPage([channelItem()]))).toEqual({
      id: CHANNEL_ID,
      title: "Rick Astley",
      avatarUrl: "https://yt3.ggpht.com/channel-high=s800",
      subscriberCount: 4_200_000,
      description: "The official Rick Astley channel.",
      uploadsPlaylistId: "UUuAXFkgsw1L7xaCfnd5JJOw",
    });
  });

  it("decodes entities in the channel title and description once", () => {
    const channel = normalizeChannelResponse(
      channelPage([
        channelItem({
          snippet: {
            title: "Mister &amp; Bbbi",
            description: "Don&#39;t miss &amp;amp; subscribe",
          },
        }),
      ]),
    );

    expect(channel?.title).toBe("Mister & Bbbi");
    expect(channel?.description).toBe("Don't miss &amp; subscribe");
  });

  it("defaults a missing description to an empty string", () => {
    const channel = normalizeChannelResponse(
      channelPage([channelItem({ snippet: { title: "Rick Astley" } })]),
    );

    expect(channel?.description).toBe("");
  });

  it("keeps only a plausible uploads playlist id", () => {
    for (const uploads of [undefined, "", "short", "UU with spaces", `UU${"x".repeat(100)}`]) {
      const channel = normalizeChannelResponse(
        channelPage([channelItem({ contentDetails: { relatedPlaylists: { uploads } } })]),
      );

      expect(channel?.uploadsPlaylistId).toBeNull();
    }

    const missing = normalizeChannelResponse(channelPage([channelItem({ contentDetails: null })]));
    expect(missing?.uploadsPlaylistId).toBeNull();
  });

  it("returns null for an empty items array", () => {
    expect(normalizeChannelResponse(channelPage([]))).toBeNull();
  });

  it("keeps a hidden subscriber count out instead of reporting zero", () => {
    const channel = normalizeChannelResponse(
      channelPage([
        channelItem({
          statistics: { subscriberCount: "4200000", hiddenSubscriberCount: true },
        }),
      ]),
    );

    expect(channel?.subscriberCount).toBeNull();
  });

  it("leaves the count null when the statistics part is missing or unusable", () => {
    for (const statistics of [
      undefined,
      {},
      { subscriberCount: "lots" },
      { subscriberCount: -1 },
    ]) {
      const channel = normalizeChannelResponse(channelPage([channelItem({ statistics })]));

      expect(channel?.subscriberCount).toBeNull();
    }
  });

  it("drops avatars from hosts the image loader cannot serve", () => {
    const channel = normalizeChannelResponse(
      channelPage([
        channelItem({
          snippet: {
            title: "Rick Astley",
            thumbnails: { high: { url: "https://example.com/avatar.jpg" } },
          },
        }),
      ]),
    );

    expect(channel).not.toBeNull();
    expect(channel?.avatarUrl).toBeNull();
  });

  it("drops non-https or malformed avatar URLs", () => {
    for (const url of [
      "http://yt3.ggpht.com/avatar.jpg",
      "not a url",
      "",
      undefined,
      { url: "https://yt3.ggpht.com/avatar.jpg" },
    ]) {
      const channel = normalizeChannelResponse(
        channelPage([
          channelItem({ snippet: { title: "Rick Astley", thumbnails: { high: { url } } } }),
        ]),
      );

      expect(channel?.avatarUrl).toBeNull();
    }
  });

  it("throws for payloads that are not channel responses", () => {
    for (const payload of [undefined, null, 42, "response", [{ items: [] }]]) {
      expectMalformed(() => normalizeChannelResponse(payload));
    }

    expectMalformed(() => normalizeChannelResponse({}));
    expectMalformed(() => normalizeChannelResponse({ items: null }));
  });

  it("skips items without a usable id, snippet or title", () => {
    const usable = channelItem();
    const unusable = [
      null,
      { snippet: usable.snippet },
      channelItem({ id: "short" }),
      channelItem({ id: `UU${CHANNEL_ID.slice(2)}` }),
      channelItem({ snippet: null }),
      channelItem({ snippet: { title: "   " } }),
      channelItem({ snippet: { title: "x".repeat(301) } }),
    ];

    // A broken first item must not hide the next usable one.
    expect(normalizeChannelResponse(channelPage([...unusable, usable]))).toMatchObject({
      id: CHANNEL_ID,
      title: "Rick Astley",
    });
    expect(normalizeChannelResponse(channelPage(unusable))).toBeNull();
  });
});
