/**
 * Category discovery sections.
 *
 * Adding, removing or renaming a category is a data change in this file alone:
 * the server-side helpers in `src/features/search/categories.ts` read this list.
 * `slug` is the public URL segment for a section, so treat shipped slugs as
 * stable and add a new entry instead of renaming an existing one.
 *
 * Kept framework-free and server-free so both server modules and presentational
 * code can import it.
 */

/** One discoverable category section. */
export interface CategoryDefinition {
  /** Stable, lowercase URL segment, e.g. `"technology"`. */
  slug: string;
  /** Human-readable section title, e.g. `"Technology"`. */
  name: string;
  /** Search terms used to fill the section. */
  query: string;
}

/**
 * The category sections shown on the discovery surface, in display order.
 *
 * Slugs and queries must stay unique; `src/shared/categories.test.ts` enforces it.
 */
export const CATEGORIES: readonly CategoryDefinition[] = [
  { slug: "music", name: "Music", query: "music" },
  { slug: "gaming", name: "Gaming", query: "gaming" },
  { slug: "technology", name: "Technology", query: "technology" },
  { slug: "sports", name: "Sports", query: "sports" },
  { slug: "news", name: "News", query: "news" },
  { slug: "comedy", name: "Comedy", query: "comedy" },
  { slug: "movies", name: "Movies", query: "movies" },
  { slug: "education", name: "Education", query: "education" },
];
