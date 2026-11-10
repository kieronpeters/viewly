/**
 * URL helpers for the search experience.
 *
 * The search page is server-rendered from the URL, so every navigation is a
 * plain href: the form pushes one, the filter controls push one and the
 * pagination link renders one. Keeping the shape in one place guarantees they
 * all preserve `q`, `pageToken` and the active filters, and cannot drift apart.
 */

import {
  DEFAULT_SEARCH_FILTERS,
  type SearchFilters,
  nonDefaultSearchFilters,
} from "@/shared/search-filters";

export const SEARCH_PATH = "/search";

/**
 * Builds `/search?q=<query>` and appends, in this stable order, the
 * continuation token when there is one and the non-default filters.
 *
 * Query values are encoded by `URLSearchParams`; a token is never invented,
 * only forwarded from a previous `SearchPage`. Default filter values are
 * omitted, so an unfiltered search keeps the short `/search?q=` URL and a
 * default selection does not split the cache or the history entry.
 */
export function buildSearchHref(
  query: string,
  pageToken?: string | null,
  filters?: Partial<SearchFilters>,
): string {
  const params = new URLSearchParams({ q: query });

  if (pageToken !== undefined && pageToken !== null && pageToken !== "") {
    params.set("pageToken", pageToken);
  }

  const activeFilters = nonDefaultSearchFilters({ ...DEFAULT_SEARCH_FILTERS, ...filters });
  if (activeFilters.duration !== undefined) {
    params.set("duration", activeFilters.duration);
  }
  if (activeFilters.order !== undefined) {
    params.set("order", activeFilters.order);
  }
  if (activeFilters.uploadDate !== undefined) {
    params.set("uploadDate", activeFilters.uploadDate);
  }

  return `${SEARCH_PATH}?${params.toString()}`;
}
