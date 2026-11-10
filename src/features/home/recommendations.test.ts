// @vitest-environment node
/**
 * Tests for the local recommendation shelves (T84).
 *
 * The selector, planner and assembler are pure, so most cases need neither a
 * database nor the network. The load test injects its own source reader and
 * search, which is also how the "one call per unique query" contract is
 * asserted.
 */
import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));

import type { SearchPage, VideoSummary } from "@/shared/types";
import { MAX_SEARCH_QUERY_LENGTH } from "@/shared/validation";

import {
  MAX_OLDEST_FAVOURITES,
  MAX_TOP_CHANNELS,
  RECOMMENDATION_CANDIDATE_LIMIT,
  RECOMMENDATION_SEED_TITLE_LIMIT,
  RECOMMENDATION_SHELF_LIMIT,
  assembleRecommendationShelves,
  loadRecommendationShelves,
  planRecommendationShelves,
  selectRecommendationSeeds,
  truncateSeedTitle,
  type RecommendationPlan,
  type RecommendationSave,
  type RecommendationSeeds,
  type RecommendationSource,
  type RecommendationView,
} from "./recommendations";

const DAY_MS = 86_400_000;

function view(
  videoId: string,
  channelTitle: string,
  lastViewedAt: number,
  overrides: Partial<RecommendationView> = {},
): RecommendationView {
  return {
    videoId,
    title: `Title ${videoId}`,
    channelTitle,
    lastViewedAt: new Date(lastViewedAt),
    viewCount: 1,
    ...overrides,
  };
}

function save(
  videoId: string,
  channelTitle: string,
  savedAt: number,
  overrides: Partial<RecommendationSave> = {},
): RecommendationSave {
  return {
    videoId,
    title: `Title ${videoId}`,
    channelTitle,
    savedAt: new Date(savedAt),
    ...overrides,
  };
}

function source(overrides: Partial<RecommendationSource> = {}): RecommendationSource {
  return { history: [], favourites: [], watchLater: [], ...overrides };
}

function seeds(overrides: Partial<RecommendationSeeds> = {}): RecommendationSeeds {
  return {
    recentView: null,
    topChannels: [],
    oldestFavourites: [],
    excludedVideoIds: [],
    ...overrides,
  };
}

/** Hand-written fixture shaped like a normalized `search.list` item. */
function summary(id: string, overrides: Partial<VideoSummary> = {}): VideoSummary {
  return {
    id,
    title: `Video ${id}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
    ...overrides,
  };
}

function page(items: VideoSummary[]): SearchPage {
  return { items, nextPageToken: null, totalResults: items.length };
}

describe("selectRecommendationSeeds", () => {
  it("picks the most recently viewed row by timestamp, not list order", () => {
    const selected = selectRecommendationSeeds(
      source({
        history: [
          view("older000001", "Channel A", DAY_MS),
          view("newest00001", "Channel B", 3 * DAY_MS),
          view("middle00001", "Channel C", 2 * DAY_MS),
        ],
      }),
    );

    expect(selected.recentView?.videoId).toBe("newest00001");
  });

  it("ranks channels by summed local views and caps the list", () => {
    const selected = selectRecommendationSeeds(
      source({
        history: [
          view("first000001", "Channel A", DAY_MS, { viewCount: 2 }),
          view("second00001", "Channel B", DAY_MS, { viewCount: 5 }),
          view("third000001", "Channel A", DAY_MS, { viewCount: 4 }),
          view("fourth00001", "Channel C", DAY_MS, { viewCount: 7 }),
          view("fifth000001", "   ", DAY_MS, { viewCount: 100 }),
        ],
      }),
    );

    expect(MAX_TOP_CHANNELS).toBe(2);
    expect(selected.topChannels).toEqual(["Channel C", "Channel A"]);
  });

  it("groups channel names case-insensitively and keeps the first spelling", () => {
    const selected = selectRecommendationSeeds(
      source({
        history: [
          view("first000001", "Rick Astley", DAY_MS, { viewCount: 1 }),
          view("second00001", "rick astley", DAY_MS, { viewCount: 1 }),
        ],
      }),
    );

    expect(selected.topChannels).toEqual(["Rick Astley"]);
  });

  it("picks the oldest favourites by save time, oldest first", () => {
    const selected = selectRecommendationSeeds(
      source({
        favourites: [
          save("newest00001", "Channel", 3 * DAY_MS),
          save("oldest00001", "Channel", DAY_MS),
          save("middle00001", "Channel", 2 * DAY_MS),
        ],
      }),
    );

    expect(MAX_OLDEST_FAVOURITES).toBe(2);
    expect(selected.oldestFavourites.map((favourite) => favourite.videoId)).toEqual([
      "oldest00001",
      "middle00001",
    ]);
  });

  it("collects watched, saved and queued ids for exclusion", () => {
    const selected = selectRecommendationSeeds(
      source({
        history: [view("watched00001", "Channel", DAY_MS)],
        favourites: [save("saved000001", "Channel", DAY_MS)],
        watchLater: [{ videoId: "queued00001" }, { videoId: "watched00001" }],
      }),
    );

    expect([...selected.excludedVideoIds].sort()).toEqual([
      "queued00001",
      "saved000001",
      "watched00001",
    ]);
  });

  it("returns empty signals for an empty library", () => {
    expect(selectRecommendationSeeds(source())).toEqual({
      recentView: null,
      topChannels: [],
      oldestFavourites: [],
      excludedVideoIds: [],
    });
  });
});

describe("planRecommendationShelves", () => {
  it("plans the three shelves and their queries in display order", () => {
    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "Recent Channel", DAY_MS, { title: "Recent Video" }),
        topChannels: ["Channel One", "Channel Two"],
        oldestFavourites: [save("oldest00001", "Old Channel", DAY_MS, { title: "Old Favourite" })],
      }),
    );

    expect(plan.shelves.map((shelf) => shelf.kind)).toEqual([
      "because-you-watched",
      "top-channels",
      "rediscover-favourites",
    ]);
    expect(plan.shelves[0]?.title).toBe("Because you watched Recent Video");
    expect(plan.shelves[0]?.fullTitle).toBe("Because you watched Recent Video");
    expect(plan.shelves[0]?.reason).not.toBe("");
    expect(plan.shelves[1]?.title).toBe("More from your top channels");
    expect(plan.shelves[1]?.queryKeys).toHaveLength(2);
    expect(plan.shelves[2]?.title).toBe("Rediscover your favourites");
    expect(plan.queries.map((query) => query.query)).toEqual([
      "Recent Video",
      "Channel One",
      "Channel Two",
      "Old Favourite",
    ]);
  });

  it("de-duplicates a query shared by several shelves", () => {
    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "Shared Signal", DAY_MS, { title: "Shared Signal" }),
        topChannels: ["Shared Signal"],
        oldestFavourites: [
          save("oldest00001", "Shared Signal", DAY_MS, {
            title: "  shared   signal ",
          }),
        ],
      }),
    );

    expect(plan.queries).toEqual([{ key: "shared signal", query: "Shared Signal" }]);

    for (const shelf of plan.shelves) {
      expect(shelf.queryKeys).toEqual(["shared signal"]);
    }
  });

  it("plans each oldest favourite as a separate rediscovery query", () => {
    const plan = planRecommendationShelves(
      seeds({
        oldestFavourites: [
          save("oldest00001", "Channel One", DAY_MS, { title: "First Favourite" }),
          save("second00001", "Channel Two", 2 * DAY_MS, { title: "Second Favourite" }),
        ],
      }),
    );

    expect(plan.shelves.map((shelf) => shelf.kind)).toEqual(["rediscover-favourites"]);
    expect(plan.queries.map((query) => query.query)).toEqual([
      "First Favourite",
      "Second Favourite",
    ]);
    expect(plan.shelves[0]?.reason).toBe("Close to your oldest saved favourites");
  });

  it("truncates a long seed title in the heading at a word boundary", () => {
    const longTitle =
      "A Very Long Video Title That Keeps Going And Going Well Past The Heading Limit For Sure";

    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "Channel", DAY_MS, { title: longTitle }),
      }),
    );

    const heading = plan.shelves[0]?.title ?? "";
    const seed = heading.replace(/^Because you watched /, "");

    expect(longTitle.length).toBeGreaterThan(RECOMMENDATION_SEED_TITLE_LIMIT);
    expect(seed).not.toBe(longTitle);
    expect(seed.endsWith("…")).toBe(true);
    // The shortened seed is a whole-word prefix of the full title.
    expect(longTitle.startsWith(seed.slice(0, -1))).toBe(true);
    expect(longTitle.charAt(seed.length - 1)).toBe(" ");
    expect(seed.length - 1).toBeLessThanOrEqual(RECOMMENDATION_SEED_TITLE_LIMIT);
    // Only the heading is shortened: the query and accessible heading are full.
    expect(plan.queries[0]?.query).toBe(longTitle);
    expect(plan.shelves[0]?.fullTitle).toBe(`Because you watched ${longTitle}`);
  });

  it("hard-cuts a single word that has no word boundary, and clamps the query", () => {
    const longWord = "A".repeat(MAX_SEARCH_QUERY_LENGTH + 20);

    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "Channel", DAY_MS, { title: longWord }),
      }),
    );

    expect(plan.queries[0]?.query).toHaveLength(MAX_SEARCH_QUERY_LENGTH);
    expect(plan.shelves[0]?.title).toBe(
      `Because you watched ${"A".repeat(RECOMMENDATION_SEED_TITLE_LIMIT)}…`,
    );
  });

  it("leaves a short seed title untouched in the heading", () => {
    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "Channel", DAY_MS, { title: "A Short Title" }),
      }),
    );

    expect(plan.shelves[0]?.title).toBe("Because you watched A Short Title");
    expect(plan.shelves[0]?.title).not.toContain("…");
    expect(plan.shelves[0]?.fullTitle).toBe(plan.shelves[0]?.title);
  });

  it("uses the stored title verbatim in the heading and query", () => {
    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "Channel", DAY_MS, {
          title: "Don't Let The Humans Into The Bar &amp; Grill",
        }),
      }),
    );

    // The library stores the title after normalization. Planning must not decode
    // it again, or a source "&amp;amp;" would lose its remaining entity.
    expect(plan.shelves[0]?.title).toBe(
      "Because you watched Don't Let The Humans Into The Bar &amp; Grill",
    );
    expect(plan.shelves[0]?.fullTitle).toBe(plan.shelves[0]?.title);
    expect(plan.queries[0]?.query).toBe("Don't Let The Humans Into The Bar &amp; Grill");
  });

  it("falls back to the channel when a video title is blank", () => {
    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "Fallback Channel", DAY_MS, { title: "   " }),
      }),
    );

    expect(plan.shelves).toHaveLength(1);
    expect(plan.shelves[0]?.title).toBe("Because you watched Fallback Channel");
    expect(plan.shelves[0]?.fullTitle).toBe("Because you watched Fallback Channel");
    expect(plan.queries[0]?.query).toBe("Fallback Channel");
  });

  it("skips a shelf whose only signal is blank", () => {
    const plan = planRecommendationShelves(
      seeds({
        recentView: view("recent00001", "   ", DAY_MS, { title: "" }),
        topChannels: ["   "],
        oldestFavourites: [save("oldest00001", "", DAY_MS, { title: "" })],
      }),
    );

    expect(plan.shelves).toEqual([]);
    expect(plan.queries).toEqual([]);
  });
});

describe("truncateSeedTitle", () => {
  it("returns a short title unchanged, without an ellipsis", () => {
    expect(truncateSeedTitle("A Short Title")).toBe("A Short Title");
  });

  it("does not split a surrogate pair when hard-cutting", () => {
    const emojiWord = "😀".repeat(RECOMMENDATION_SEED_TITLE_LIMIT + 5);

    const truncated = truncateSeedTitle(emojiWord);

    expect(Array.from(truncated)).toHaveLength(RECOMMENDATION_SEED_TITLE_LIMIT + 1);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("assembleRecommendationShelves", () => {
  const plan: RecommendationPlan = {
    queries: [
      { key: "a", query: "A" },
      { key: "b", query: "B" },
      { key: "c", query: "C" },
    ],
    shelves: [
      {
        kind: "because-you-watched",
        title: "Because you watched Something",
        fullTitle: "Because you watched Something",
        reason: "Recent",
        queryKeys: ["a"],
      },
      {
        kind: "top-channels",
        title: "More from your top channels",
        fullTitle: "More from your top channels",
        reason: "Channels",
        queryKeys: ["b"],
      },
      {
        kind: "rediscover-favourites",
        title: "Rediscover your favourites",
        fullTitle: "Rediscover your favourites",
        reason: "Oldest",
        queryKeys: ["c"],
      },
    ],
  };

  it("excludes watched and saved ids and drops cross-shelf duplicates", () => {
    const results = new Map<string, readonly VideoSummary[]>([
      ["a", [summary("shared00001"), summary("watched00001"), summary("first000001")]],
      ["b", [summary("shared00001"), summary("second00001"), summary("saved000001")]],
      ["c", [summary("first000001"), summary("third000001")]],
    ]);

    const shelves = assembleRecommendationShelves(plan, results, ["watched00001", "saved000001"]);

    expect(shelves.map((shelf) => shelf.kind)).toEqual([
      "because-you-watched",
      "top-channels",
      "rediscover-favourites",
    ]);
    expect(shelves[0]?.videos.map((video) => video.id)).toEqual(["shared00001", "first000001"]);
    expect(shelves[1]?.videos.map((video) => video.id)).toEqual(["second00001"]);
    expect(shelves[2]?.videos.map((video) => video.id)).toEqual(["third000001"]);
  });

  it("takes candidates in rounds when a shelf has several queries", () => {
    const shelves = assembleRecommendationShelves(
      {
        queries: [
          { key: "a", query: "A" },
          { key: "b", query: "B" },
        ],
        shelves: [
          {
            kind: "top-channels",
            title: "More from your top channels",
            fullTitle: "More from your top channels",
            reason: "Channels",
            queryKeys: ["a", "b"],
          },
        ],
      },
      new Map([
        ["a", [summary("channelA001"), summary("channelA002"), summary("channelA003")]],
        ["b", [summary("channelB001"), summary("channelB002")]],
      ]),
    );

    expect(shelves[0]?.videos.map((video) => video.id)).toEqual([
      "channelA001",
      "channelB001",
      "channelA002",
      "channelB002",
      "channelA003",
    ]);
  });

  it("caps each shelf independently", () => {
    const candidates = Array.from({ length: RECOMMENDATION_SHELF_LIMIT + 4 }, (_, index) =>
      summary(`candidate${String(index).padStart(2, "0")}`),
    );
    const shelves = assembleRecommendationShelves(
      {
        queries: [{ key: "a", query: "A" }],
        shelves: [
          {
            kind: "because-you-watched",
            title: "Because you watched Something",
            fullTitle: "Because you watched Something",
            reason: "Recent",
            queryKeys: ["a"],
          },
        ],
      },
      new Map([["a", candidates]]),
    );

    expect(shelves[0]?.videos).toHaveLength(RECOMMENDATION_SHELF_LIMIT);
    expect(shelves[0]?.videos.map((video) => video.id)).toEqual(
      candidates.slice(0, RECOMMENDATION_SHELF_LIMIT).map((video) => video.id),
    );
  });

  it("omits a shelf with no usable candidates", () => {
    const shelves = assembleRecommendationShelves(
      plan,
      new Map([
        ["a", []],
        ["b", [summary("", { title: "No id" }), summary("blank000001", { title: "  " })]],
        ["c", [summary("kept0000001")]],
      ]),
    );

    expect(shelves.map((shelf) => shelf.kind)).toEqual(["rediscover-favourites"]);
  });

  it("returns nothing when every shelf is empty", () => {
    expect(
      assembleRecommendationShelves(
        plan,
        new Map([
          ["a", []],
          ["b", []],
          ["c", []],
        ]),
      ),
    ).toEqual([]);
  });

  it("does not mutate the excluded ids or the candidate list", () => {
    const excluded = ["watched00001"];
    const candidates = [summary("watched00001"), summary("fresh000001")];

    assembleRecommendationShelves(
      {
        queries: [{ key: "a", query: "A" }],
        shelves: [
          {
            kind: "because-you-watched",
            title: "Because you watched Something",
            fullTitle: "Because you watched Something",
            reason: "Recent",
            queryKeys: ["a"],
          },
        ],
      },
      new Map([["a", candidates]]),
      excluded,
    );

    expect(excluded).toEqual(["watched00001"]);
    expect(candidates).toHaveLength(2);
  });
});

describe("loadRecommendationShelves", () => {
  it("searches each unique query once, even when shelves share it", async () => {
    const candidates = Array.from({ length: RECOMMENDATION_SHELF_LIMIT * 3 }, (_, index) =>
      summary(`shared${String(index).padStart(5, "0")}`),
    );
    const search = vi.fn(async () => page(candidates));

    const shelves = await loadRecommendationShelves(
      () =>
        source({
          history: [view("recent00001", "Shared Signal", DAY_MS, { title: "Shared Signal" })],
          favourites: [save("oldest00001", "Shared Signal", DAY_MS, { title: "shared signal" })],
        }),
      search,
    );

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({
      query: "Shared Signal",
      maxResults: RECOMMENDATION_CANDIDATE_LIMIT,
    });
    expect(shelves.map((shelf) => shelf.kind)).toEqual([
      "because-you-watched",
      "top-channels",
      "rediscover-favourites",
    ]);
  });

  it("queries each distinct signal once and never repeats a query", async () => {
    const search = vi.fn(async ({ query }: { query: string }) =>
      page([summary(`candidate ${query}`)]),
    );

    await loadRecommendationShelves(
      () =>
        source({
          history: [
            view("recent00001", "Channel One", 2 * DAY_MS, { title: "Recent Video" }),
            view("frequent0001", "Channel One", DAY_MS, { viewCount: 4 }),
          ],
          favourites: [save("oldest00001", "Channel Two", DAY_MS, { title: "Old Favourite" })],
        }),
      search,
    );

    const queries = search.mock.calls.map(([options]) => options.query);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.sort()).toEqual(["Channel One", "Old Favourite", "Recent Video"]);
  });

  it("hides only the shelf whose search failed", async () => {
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query === "Broken Channel") {
        throw new Error("upstream failure");
      }

      return page([summary(`candidate ${query}`)]);
    });

    const shelves = await loadRecommendationShelves(
      () =>
        source({
          history: [
            view("recent00001", "Broken Channel", DAY_MS, {
              title: "Recent Video",
              viewCount: 5,
            }),
          ],
          favourites: [save("oldest00001", "Old Channel", DAY_MS, { title: "Old Favourite" })],
        }),
      search,
    );

    expect(shelves.map((shelf) => shelf.kind)).toEqual([
      "because-you-watched",
      "rediscover-favourites",
    ]);
  });

  it("returns no shelves and makes no search when the library has no signals", async () => {
    const search = vi.fn();

    await expect(loadRecommendationShelves(() => source(), search)).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps a partially successful top-channels shelf", async () => {
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query === "Channel One") {
        throw new Error("upstream failure");
      }

      return page([summary(`candidate ${query}`)]);
    });

    const shelves = await loadRecommendationShelves(
      () =>
        source({
          history: [
            view("recent00001", "Channel One", 3 * DAY_MS, { title: "", viewCount: 3 }),
            view("frequent0001", "Channel Two", 2 * DAY_MS, { viewCount: 1 }),
          ],
        }),
      search,
    );

    expect(shelves.map((shelf) => shelf.kind)).toEqual(["top-channels"]);
    expect(shelves[0]?.videos.map((video) => video.id)).toEqual(["candidate Channel Two"]);
  });
});
