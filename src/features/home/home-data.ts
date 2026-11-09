/**
 * Server-side reads for the home discovery page.
 *
 * The page itself never imports the YouTube client or the category service: it
 * goes through the feature entry point (`./index.ts`), which keeps the import
 * boundary in one place and makes the sections easy to test with mocks.
 *
 * Caching intentionally lives in `src/lib/youtube/client.ts` (T18), so these
 * helpers stay thin: they only select what the home page shows and normalize it
 * to the shapes the UI reads.
 */

import "server-only";

import { getCategoryVideos, listCategories } from "@/features/search/categories";
import { getTrending } from "@/lib/youtube/client";
import type { VideoSummary } from "@/shared/types";

/**
 * Categories shown as discovery rows, in display order.
 *
 * `search.list` allows 100 calls per day, and every row spends one. Three rows
 * plus trending keeps a home page load at four calls while still giving the
 * page a browsable shape. Adding a row is a one-line change here.
 */
export const HOME_CATEGORY_SLUGS = ["music", "gaming", "technology"] as const;

/** The subset of a category the home page renders. */
export interface HomeCategory {
  /** Stable URL segment from the shared category list. */
  slug: string;
  /** Human-readable row title. */
  name: string;
}

/**
 * Resolves the home category rows from the shared T17 list.
 *
 * Slugs that no longer exist are skipped instead of throwing, so removing a
 * category in `src/shared/categories.ts` degrades to fewer rows rather than
 * failing the whole page. Reads no request data, so it can run in the static
 * shell.
 */
export function getHomeCategories(): readonly HomeCategory[] {
  const bySlug = new Map(listCategories().map((category) => [category.slug, category]));

  const rows: HomeCategory[] = [];
  for (const slug of HOME_CATEGORY_SLUGS) {
    const category = bySlug.get(slug);
    if (category !== undefined) {
      rows.push({ slug: category.slug, name: category.name });
    }
  }

  return rows;
}

/**
 * Every category in the shared T17 list, for the browse chips.
 *
 * Purely a projection of `listCategories()`: no filtering, no network. All
 * eight categories stay reachable even though only three get a full row.
 */
export function getAllCategories(): readonly HomeCategory[] {
  return listCategories().map((category) => ({
    slug: category.slug,
    name: category.name,
  }));
}

/**
 * Fetches the trending row, using the client's default region.
 *
 * @throws {YouTubeApiError} for transport, HTTP and payload failures.
 */
export async function getTrendingVideos(): Promise<VideoSummary[]> {
  return getTrending();
}

/**
 * Fetches one category row.
 *
 * An unknown slug yields an empty row (the category service returns null
 * without touching the network) rather than an error.
 *
 * @throws {YouTubeApiError} for transport, HTTP and payload failures.
 */
export async function getCategoryRowVideos(slug: string): Promise<VideoSummary[]> {
  const page = await getCategoryVideos(slug);

  return page?.items ?? [];
}
