/**
 * Local recommendation shelves for the home page (T84).
 *
 * ## Data sources
 *
 * Two sources, both already local:
 *
 * - the library repository's existing list reads (`history.list()`,
 *   `favourites.list()`, `watchLater.list()`), which provide the signals —
 *   most recent view, most frequent channels and oldest saved favourites;
 * - the cached `searchVideos` client call, which provides the candidate cards.
 *
 * There is no SQL in this module and no cloud model: every ranking decision is
 * made from the rows the repository already returns, in memory. A future query
 * that the existing list functions cannot answer belongs in a **new** file
 * under `src/lib/db/repositories/`; `library.repository.ts` is deliberately not
 * touched here because the stats feature is editing it.
 *
 * ## Shape of a load
 *
 * 1. {@link selectRecommendationSeeds} reads the signals from the source rows.
 * 2. {@link planRecommendationShelves} turns them into at most three shelves
 *    and one **de-duplicated** list of search queries.
 * 3. Each unique query is searched once. Failures are scoped to that query, so
 *    one broken channel search cannot hide the other shelves.
 * 4. {@link assembleRecommendationShelves} applies exclusions (already watched,
 *    saved or queued) and cross-shelf de-duplication, then caps each shelf.
 *
 * The pure steps are exported so selection and de-duplication can be tested
 * without a database or the network.
 */

import "server-only";

import { cache } from "react";

import { getDb } from "@/lib/db/client";
import { createLibraryRepository } from "@/lib/db/repositories/library.repository";
import { searchVideos } from "@/lib/youtube/client";
import type { SearchPage, VideoSummary } from "@/shared/types";
import { MAX_SEARCH_QUERY_LENGTH } from "@/shared/validation";

/** Maximum cards per shelf. Matches the watch page's suggestion cap. */
export const RECOMMENDATION_SHELF_LIMIT = 8;

/**
 * Requested `maxResults` per search.
 *
 * Slightly above the shelf cap because a result page can contain an excluded
 * (already watched or saved) video or a duplicate, and still fill the row. The
 * value is part of the YouTube cache key, so keeping it constant lets repeated
 * home loads reuse the cached search response instead of fetching again.
 */
export const RECOMMENDATION_CANDIDATE_LIMIT = 12;

/** How many distinct channels the "top channels" shelf may search. */
export const MAX_TOP_CHANNELS = 2;

/** How many of the oldest favourites the rediscovery shelf may search. */
export const MAX_OLDEST_FAVOURITES = 2;

/**
 * Longest seed title the "because you watched" heading may show, in characters.
 *
 * Stored video titles are often far longer than a heading should be, and the
 * full title would push the row heading across several lines at both narrow and
 * wide viewports. Only the displayed heading is shortened: the search query and
 * the cards keep the complete title, and the complete heading is still exposed
 * to assistive tech through {@link RecommendationShelf.fullTitle}.
 */
export const RECOMMENDATION_SEED_TITLE_LIMIT = 60;

/** Stable shelf identifiers; also used in DOM ids and React keys. */
export type RecommendationShelfKind =
  "because-you-watched" | "top-channels" | "rediscover-favourites";

/**
 * One history row as the selector needs it.
 *
 * Structurally satisfied by `HistoryRow`, but kept minimal so tests can build
 * fixtures without a database row's every column.
 */
export interface RecommendationView {
  videoId: string;
  title: string;
  channelTitle: string;
  lastViewedAt: Date;
  viewCount: number;
}

/** One favourite row as the selector needs it; structurally a `FavouriteRow`. */
export interface RecommendationSave {
  videoId: string;
  title: string;
  channelTitle: string;
  savedAt: Date;
}

/** The repository reads a home-page recommendation load is built from. */
export interface RecommendationSource {
  history: readonly RecommendationView[];
  favourites: readonly RecommendationSave[];
  /** Only the ids are used, to keep the queue out of every shelf. */
  watchLater: readonly { videoId: string }[];
}

/** Signals selected from {@link RecommendationSource}. */
export interface RecommendationSeeds {
  /** Most recently viewed row, or null when history is empty. */
  recentView: RecommendationView | null;
  /** Channel names ordered by total local views, most frequent first. */
  topChannels: string[];
  /** Least recently saved favourites, oldest first; at most two. */
  oldestFavourites: RecommendationSave[];
  /** Ids that must never appear in a shelf: watched, saved or queued. */
  excludedVideoIds: string[];
}

/** One unique search to perform, with the key its results are stored under. */
export interface RecommendationQuery {
  /** Case-insensitive, whitespace-normalized query, used for de-duplication. */
  key: string;
  /** Query text sent to `searchVideos`, preserving its original casing. */
  query: string;
}

/** A shelf before candidate results are attached. */
export interface RecommendationPlannedShelf {
  kind: RecommendationShelfKind;
  /**
   * Heading as displayed.
   *
   * For "because you watched", a long seed title is shortened here (and only
   * here); every other field keeps the full title.
   */
  title: string;
  /**
   * Complete heading text before any display truncation.
   *
   * Equal to {@link title} unless a seed title was shortened. The section uses
   * it as the heading's accessible name, so assistive tech hears the full title
   * instead of the ellipsis.
   */
  fullTitle: string;
  /** Short "why this row" label rendered under the heading. */
  reason: string;
  /** Query keys whose results feed this shelf, in display order. */
  queryKeys: string[];
}

/** Output of {@link planRecommendationShelves}. */
export interface RecommendationPlan {
  queries: RecommendationQuery[];
  shelves: RecommendationPlannedShelf[];
}

/** A rendered shelf: heading, reason label and its capped card list. */
export interface RecommendationShelf {
  kind: RecommendationShelfKind;
  /** Heading as displayed; a long "because you watched" seed is shortened. */
  title: string;
  /** Complete heading text, used as the heading's accessible name. */
  fullTitle: string;
  reason: string;
  videos: VideoSummary[];
}

/** Signature of the candidate search, injectable for tests. */
export type RecommendationSearch = (options: {
  query: string;
  maxResults?: number;
}) => Promise<SearchPage>;

/** Reader for the local source rows, injectable for tests. */
export type RecommendationSourceReader = () => RecommendationSource;

/**
 * Reads the existing library list rows for a recommendation load.
 *
 * Uses the repository's public list functions only: no new query and no SQL in
 * the feature module. All three lists are small, local and synchronous.
 */
export function readRecommendationSource(): RecommendationSource {
  const repository = createLibraryRepository(getDb());

  return {
    history: repository.history.list(),
    favourites: repository.favourites.list(),
    watchLater: repository.watchLater.list(),
  };
}

/**
 * Selects the local signals from the source rows.
 *
 * Ordering does not depend on the repository's list order: the most recent view
 * and the oldest favourites are chosen by timestamp, so a caller that supplies
 * unsorted fixtures still gets the same answer. Ties fall back to the video id,
 * which keeps the result deterministic.
 *
 * Channels are ranked by summed `viewCount` across history. Only history has a
 * frequency signal; a favourite contributes to exclusions, not to the ranking.
 */
export function selectRecommendationSeeds(source: RecommendationSource): RecommendationSeeds {
  return {
    recentView: pickMostRecent(source.history),
    topChannels: rankChannels(source.history),
    oldestFavourites: pickOldest(source.favourites, MAX_OLDEST_FAVOURITES),
    excludedVideoIds: collectExcludedIds(source),
  };
}

/**
 * Turns the selected signals into shelves and the unique queries they need.
 *
 * Each shelf searches by the most specific local signal available: the title of
 * the video for "because you watched" and "rediscover", the channel name for
 * "top channels". A blank title falls back to the channel, and a blank channel
 * is skipped rather than sent as an invalid query.
 *
 * Queries are de-duplicated case-insensitively. If the same text is needed by
 * two shelves (for example a video title equal to a channel name), it is
 * searched once and both shelves read from the same result set.
 */
export function planRecommendationShelves(seeds: RecommendationSeeds): RecommendationPlan {
  const queries = new Map<string, RecommendationQuery>();
  const shelves: RecommendationPlannedShelf[] = [];

  /** Registers a query once and returns its key, or null for blank text. */
  const addQuery = (value: string): string | null => {
    const query = clampSearchQuery(normalizeQuery(value));
    if (query === "") {
      return null;
    }

    const key = query.toLowerCase();
    if (!queries.has(key)) {
      queries.set(key, { key, query });
    }

    return key;
  };

  if (seeds.recentView !== null) {
    const title = displayTitle(seeds.recentView.title, seeds.recentView.channelTitle);
    const queryKey = addQuery(seeds.recentView.title) ?? addQuery(seeds.recentView.channelTitle);

    if (queryKey !== null) {
      const fullTitle =
        title === "" ? "Because you watched a recent video" : `Because you watched ${title}`;
      const heading = title === "" ? fullTitle : `Because you watched ${truncateSeedTitle(title)}`;

      shelves.push({
        kind: "because-you-watched",
        title: heading,
        fullTitle,
        reason: "Based on your most recent view",
        queryKeys: [queryKey],
      });
    }
  }

  const channelQueryKeys: string[] = [];
  for (const channel of seeds.topChannels) {
    const queryKey = addQuery(channel);
    if (queryKey !== null && !channelQueryKeys.includes(queryKey)) {
      channelQueryKeys.push(queryKey);
    }
  }

  if (channelQueryKeys.length > 0) {
    const heading = "More from your top channels";

    shelves.push({
      kind: "top-channels",
      title: heading,
      fullTitle: heading,
      reason: `Channels you watch most: ${seeds.topChannels.join(", ")}`,
      queryKeys: channelQueryKeys,
    });
  }

  if (seeds.oldestFavourites.length > 0) {
    const favouriteQueryKeys: string[] = [];

    for (const favourite of seeds.oldestFavourites) {
      const queryKey = addQuery(favourite.title) ?? addQuery(favourite.channelTitle);
      if (queryKey !== null && !favouriteQueryKeys.includes(queryKey)) {
        favouriteQueryKeys.push(queryKey);
      }
    }

    if (favouriteQueryKeys.length > 0) {
      const heading = "Rediscover your favourites";

      shelves.push({
        kind: "rediscover-favourites",
        title: heading,
        fullTitle: heading,
        reason:
          seeds.oldestFavourites.length === 1
            ? "Close to your oldest saved favourite"
            : "Close to your oldest saved favourites",
        queryKeys: favouriteQueryKeys,
      });
    }
  }

  return { queries: [...queries.values()], shelves };
}

/**
 * Builds the final shelves from the planned queries and their results.
 *
 * Exclusions are global: an id that is in history, favourites or watch later is
 * never shown, and an id already used by an earlier shelf is not repeated in a
 * later one. Shelves are processed in plan order (newest signal first), so the
 * most personal shelf keeps a contested candidate.
 *
 * A shelf with several queries (the top-channels and rediscovery rows) takes
 * candidates in rounds across those queries, so both channels or both old
 * favourites contribute instead of the first one filling the row on its own.
 * Within each query, relevance order is kept.
 *
 * Candidates without a usable id or title are skipped, a later duplicate of an
 * already-kept id is dropped, and each shelf stops at `limit`. A shelf with no
 * usable cards is omitted entirely, which is how the section hides.
 */
export function assembleRecommendationShelves(
  plan: RecommendationPlan,
  results: ReadonlyMap<string, readonly VideoSummary[]>,
  excludedVideoIds: readonly string[] = [],
  limit: number = RECOMMENDATION_SHELF_LIMIT,
): RecommendationShelf[] {
  const max = Math.max(0, Math.trunc(limit));
  const used = new Set(excludedVideoIds);
  const shelves: RecommendationShelf[] = [];

  for (const planned of plan.shelves) {
    const queues = planned.queryKeys.map((key) => results.get(key) ?? []);
    const positions = queues.map(() => 0);
    const videos: VideoSummary[] = [];

    while (videos.length < max) {
      let added = false;

      for (let index = 0; index < queues.length; index += 1) {
        if (videos.length >= max) {
          break;
        }

        const queue = queues[index];
        if (queue === undefined) {
          continue;
        }

        let position = positions[index] ?? 0;

        while (position < queue.length) {
          const candidate = queue[position];
          position += 1;

          if (candidate === undefined || !isDisplayableCandidate(candidate)) {
            continue;
          }

          if (used.has(candidate.id)) {
            continue;
          }

          used.add(candidate.id);
          videos.push(candidate);
          added = true;
          break;
        }

        positions[index] = position;
      }

      if (!added) {
        break;
      }
    }

    if (videos.length > 0) {
      shelves.push({
        kind: planned.kind,
        title: planned.title,
        fullTitle: planned.fullTitle,
        reason: planned.reason,
        videos,
      });
    }
  }

  return shelves;
}

/**
 * Runs one complete recommendation load.
 *
 * Each unique query is searched exactly once, regardless of how many shelves
 * read it. A failed query contributes no candidates and does not reject the
 * load; a failed source read is the one exception and propagates, because
 * without local signals there is nothing to plan (the section then hides).
 *
 * The default search is the shared `searchVideos`, so repeated loads inside its
 * 60 s cache window do not touch the network. Dependencies are injectable so
 * tests can assert the call count without a database.
 */
export async function loadRecommendationShelves(
  readSource: RecommendationSourceReader = readRecommendationSource,
  search: RecommendationSearch = searchVideos,
): Promise<RecommendationShelf[]> {
  const seeds = selectRecommendationSeeds(readSource());
  const plan = planRecommendationShelves(seeds);

  if (plan.queries.length === 0) {
    return [];
  }

  const settled = await Promise.all(
    plan.queries.map(async ({ key, query }) => {
      try {
        const page = await search({ query, maxResults: RECOMMENDATION_CANDIDATE_LIMIT });
        return { key, items: page.items };
      } catch {
        // One shelf's query failing must not fail the whole page. The shelf
        // reads no candidates and is omitted from the result.
        return { key, items: [] as VideoSummary[] };
      }
    }),
  );

  return assembleRecommendationShelves(
    plan,
    new Map(settled.map(({ key, items }) => [key, items])),
    seeds.excludedVideoIds,
  );
}

/**
 * Request-scoped loader shared by the three shelf sections.
 *
 * `cache()` de-duplicates the load across the sibling Server Components in one
 * render, including their separate `<Suspense>` boundaries, so the home page
 * performs one source read and one search per unique query. Outside a render
 * (tests, scripts) React calls the function directly, which keeps the default
 * uncached path usable.
 */
export const getRecommendationShelves = cache(async (): Promise<RecommendationShelf[]> =>
  loadRecommendationShelves(),
);

/** Most recently viewed row, or null. Later timestamps win; id breaks ties. */
function pickMostRecent(rows: readonly RecommendationView[]): RecommendationView | null {
  let latest: RecommendationView | null = null;

  for (const row of rows) {
    if (latest === null) {
      latest = row;
      continue;
    }

    const delta = row.lastViewedAt.getTime() - latest.lastViewedAt.getTime();
    if (delta > 0 || (delta === 0 && row.videoId < latest.videoId)) {
      latest = row;
    }
  }

  return latest;
}

/** The least recently saved favourites, oldest first. */
function pickOldest(rows: readonly RecommendationSave[], limit: number): RecommendationSave[] {
  const max = Math.max(0, Math.trunc(limit));
  if (max === 0) {
    return [];
  }

  return [...rows]
    .sort((left, right) => {
      const delta = left.savedAt.getTime() - right.savedAt.getTime();
      return delta !== 0 ? delta : left.videoId.localeCompare(right.videoId);
    })
    .slice(0, max);
}

/**
 * Ranks channels by summed local views.
 *
 * Names are grouped case-insensitively so "Rick Astley" and "rick astley" are one
 * channel, while the first spelling seen is the one displayed. Blank names are
 * dropped; equal totals sort alphabetically for a stable result.
 */
function rankChannels(rows: readonly RecommendationView[]): string[] {
  const byName = new Map<string, { name: string; views: number }>();

  for (const row of rows) {
    const name = row.channelTitle.trim();
    if (name === "") {
      continue;
    }

    const key = name.toLowerCase();
    const views = Number.isFinite(row.viewCount) ? Math.max(0, row.viewCount) : 0;
    const current = byName.get(key);

    if (current === undefined) {
      byName.set(key, { name, views });
    } else {
      current.views += views;
    }
  }

  return [...byName.values()]
    .sort((left, right) => right.views - left.views || left.name.localeCompare(right.name))
    .slice(0, MAX_TOP_CHANNELS)
    .map((entry) => entry.name);
}

/** Union of every id the user has already watched, saved or queued. */
function collectExcludedIds(source: RecommendationSource): string[] {
  const ids = new Set<string>();

  for (const row of source.history) {
    ids.add(row.videoId);
  }
  for (const row of source.favourites) {
    ids.add(row.videoId);
  }
  for (const row of source.watchLater) {
    ids.add(row.videoId);
  }

  return [...ids];
}

/** Collapses surrounding and internal whitespace so query variants share a key. */
function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Truncates a normalized query to the client's validation limit.
 *
 * Stored titles can be longer than `search.list` accepts. A truncated title is
 * still a useful title search, whereas an over-long one would make
 * `searchVideos` reject and hide the shelf.
 */
function clampSearchQuery(query: string): string {
  if (query.length <= MAX_SEARCH_QUERY_LENGTH) {
    return query;
  }

  return Array.from(query).slice(0, MAX_SEARCH_QUERY_LENGTH).join("").trim();
}

/** Trimmed title, or the channel when the title is blank. */
function displayTitle(title: string, channelTitle: string): string {
  return normalizeQuery(title) || normalizeQuery(channelTitle);
}

/**
 * Shortens a seed title for the heading, cutting on a word boundary.
 *
 * `limit` is the maximum number of characters kept from the title; the ellipsis
 * is added on top. A single word longer than the limit is cut at the limit,
 * because there is no boundary to prefer. The result never splits a surrogate
 * pair, since the cut is made over code points rather than UTF-16 units.
 *
 * This is display-only: the caller still searches with the complete title.
 */
export function truncateSeedTitle(
  title: string,
  limit: number = RECOMMENDATION_SEED_TITLE_LIMIT,
): string {
  const text = normalizeQuery(title);
  if (text.length <= limit) {
    return text;
  }

  const max = Math.max(1, Math.trunc(limit));
  const head = Array.from(text).slice(0, max).join("");
  const boundary = head.lastIndexOf(" ");
  const clipped = (boundary > 0 ? head.slice(0, boundary) : head).trimEnd();

  return `${clipped}…`;
}

/**
 * Runtime guard for a candidate that reached the UI.
 *
 * Values normally come from the normalizer; a list is cheap to defend, and a
 * candidate without a non-blank id and title cannot be a card.
 */
function isDisplayableCandidate(value: unknown): value is VideoSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<VideoSummary>;

  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    return false;
  }

  return typeof candidate.title === "string" && candidate.title.trim() !== "";
}
