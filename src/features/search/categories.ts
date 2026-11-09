/**
 * Server-side category discovery helpers.
 *
 * A thin read layer over the shared category list and the YouTube client: it
 * resolves a public slug to its search query and fetches one page of results.
 * Adding a category is a data change in `src/shared/categories.ts` only; this
 * module never needs editing for it.
 *
 * Caching is intentionally absent here: the cache layer is owned by T18 and is
 * expected to wrap these calls rather than live inside them.
 */

import "server-only";

import { searchVideos } from "@/lib/youtube/client";
import { CATEGORIES, type CategoryDefinition } from "@/shared/categories";
import type { SearchPage } from "@/shared/types";
import { assertPageToken } from "@/shared/validation";

/** Options for {@link getCategoryVideos}. */
export interface GetCategoryVideosOptions {
  /** Continuation token from a previous page, or null/absent for the first page. */
  pageToken?: string | null;
}

/**
 * Returns the category sections in display order.
 *
 * The array is shared and read-only; callers must not mutate it.
 */
export function listCategories(): readonly CategoryDefinition[] {
  return CATEGORIES;
}

/** Resolves a public slug to its category, or null when the slug is unknown. */
export function getCategoryBySlug(slug: string): CategoryDefinition | null {
  return CATEGORIES.find((category) => category.slug === slug) ?? null;
}

/**
 * Fetches one page of videos for a category.
 *
 * Returns null for an unknown slug without touching the network. Known slugs are
 * searched with the category query; the page token is validated with
 * `assertPageToken`, which throws `DomainValidationError` for hostile input.
 *
 * @throws {DomainValidationError} when `pageToken` is not URL-safe or too long.
 * @throws {YouTubeApiError} for transport, HTTP and payload failures.
 */
export async function getCategoryVideos(
  slug: string,
  options: GetCategoryVideosOptions = {},
): Promise<SearchPage | null> {
  const category = getCategoryBySlug(slug);
  if (category === null) {
    return null;
  }

  const pageToken = assertPageToken(options.pageToken ?? null);

  return searchVideos({ query: category.query, pageToken });
}
