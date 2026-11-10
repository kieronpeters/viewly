import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchFilters, SearchFiltersWithQuery } from "@/components/search/search-filters";
import { SearchForm, SearchFormWithQuery } from "@/components/search/search-form";
import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";
import { DEFAULT_SEARCH_FILTERS } from "@/shared/search-filters";

import { SearchResults, type SearchParams } from "./search-results";

export const metadata: Metadata = {
  title: "Search · Viewly",
  description: "Search YouTube videos by topic, channel or title.",
};

export interface SearchPageProps {
  /**
   * Next 16 runtime API: a promise that is only known per request. It is passed
   * to `<SearchResults>` untouched and awaited inside `<Suspense>`.
   */
  searchParams: Promise<SearchParams>;
}

/**
 * `/search` route shell.
 *
 * The shell itself reads no request data, so the heading and form are part of
 * the prerendered static shell. The URL-dependent pieces sit behind two
 * `<Suspense>` boundaries required by Cache Components:
 *
 * - the form and filter controls, which read the current `?q=` and filter
 *   parameters through `useSearchParams`;
 * - the results, which await `searchParams` and call the YouTube client.
 */
export default function SearchPage({ searchParams }: SearchPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section aria-labelledby="search-heading" className="flex flex-col gap-4">
        <h1
          id="search-heading"
          className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
        >
          Search
        </h1>
        <Suspense fallback={<SearchForm />}>
          <SearchFormWithQuery />
        </Suspense>
        <Suspense fallback={<SearchFilters query="" filters={{ ...DEFAULT_SEARCH_FILTERS }} />}>
          <SearchFiltersWithQuery />
        </Suspense>
      </section>

      <Suspense fallback={<SearchResultsSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
