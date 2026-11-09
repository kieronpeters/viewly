/**
 * URL helpers for the search experience.
 *
 * The search page is server-rendered from the URL, so every navigation is a
 * plain href: the form pushes one and the pagination link renders one. Keeping
 * the shape in one place guarantees both keep `q` and cannot drift apart.
 */

export const SEARCH_PATH = "/search";

/**
 * Builds `/search?q=<query>` and appends the YouTube continuation token when
 * there is one. Query values are encoded by `URLSearchParams`; a token is never
 * invented, only forwarded from a previous `SearchPage`.
 */
export function buildSearchHref(query: string, pageToken?: string | null): string {
  const params = new URLSearchParams({ q: query });

  if (pageToken !== undefined && pageToken !== null && pageToken !== "") {
    params.set("pageToken", pageToken);
  }

  return `${SEARCH_PATH}?${params.toString()}`;
}
