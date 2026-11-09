import Link from "next/link";

import { SearchError } from "@/components/search/search-error";
import { buildSearchHref } from "@/components/search/search-url";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VideoCard } from "@/components/video/video-card";
import { isYouTubeApiError, searchVideos } from "@/lib/youtube/client";
import type { SearchPage } from "@/shared/types";
import { assertPageToken, assertSearchQuery, isDomainValidationError } from "@/shared/validation";

/** The App Router's plain-object view of the URL query string. */
export type SearchParams = Record<string, string | string[] | undefined>;

export interface SearchResultsProps {
  /** Passed straight through from the page: only this component awaits it. */
  searchParams: Promise<SearchParams>;
}

/**
 * The dynamic half of `/search`.
 *
 * Reading `searchParams` and calling the YouTube client happen here, inside the
 * page's `<Suspense>` boundary, so the heading and form can be prerendered and
 * the results stream in at request time. `searchVideos` is called in-process:
 * there is deliberately no internal `fetch` to `/api/search`.
 *
 * Every external failure is caught and rendered as authored copy, so a quota
 * error or a bad token never reaches the route-level error boundary.
 */
export async function SearchResults({ searchParams }: SearchResultsProps) {
  const params = await searchParams;
  const rawQuery = firstParam(params.q);

  if (rawQuery === null || rawQuery.trim() === "") {
    return (
      <EmptyState
        title="Search Viewly"
        message="Type a topic, channel or video title to find something to watch."
      />
    );
  }

  let query: string;
  try {
    query = assertSearchQuery(rawQuery);
  } catch (error) {
    return <EmptyState title="That search can't be run" message={describeValidationError(error)} />;
  }

  let pageToken: string | null;
  try {
    pageToken = assertPageToken(firstParam(params.pageToken));
  } catch {
    return (
      <EmptyState
        title="That results link is not valid"
        message="Start a new search using the box above."
      />
    );
  }

  let page: SearchPage;
  try {
    page = await searchVideos({ query, pageToken });
  } catch (error) {
    return <SearchError message={describeSearchError(error)} />;
  }

  if (page.items.length === 0) {
    return (
      <EmptyState
        title={`No results for “${query}”`}
        message="Try a different spelling or fewer words."
      />
    );
  }

  return (
    <section aria-labelledby="search-results-heading" className="flex flex-col gap-4">
      <h2 id="search-results-heading" className="sr-only">
        Search results
      </h2>
      <p className="text-sm break-words text-muted-foreground">
        Results for <span className="font-medium text-foreground">“{query}”</span>
      </p>

      <ul
        role="list"
        className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {page.items.map((video) => (
          <li key={video.id} className="min-w-0">
            <VideoCard video={video} className="h-full" />
          </li>
        ))}
      </ul>

      {page.nextPageToken === null ? null : (
        <div className="flex justify-center pt-2">
          <Button asChild variant="outline" size="lg" className="min-h-11">
            <Link href={buildSearchHref(query, page.nextPageToken)} prefetch={false}>
              Load more results
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Repeated query parameters arrive as an array. The first value is the one a
 * form or link actually sent, so it wins; the rest are ignored deterministically
 * instead of making the page behave differently per access.
 */
function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

/** Validation messages are authored by the shared module: safe to show as-is. */
function describeValidationError(error: unknown): string {
  if (isDomainValidationError(error)) {
    return error.message;
  }

  return "Check the spelling and try again.";
}

/**
 * Maps a client failure to user-facing copy. Upstream status, reasons and the
 * request URL are never rendered; only the stable code decides the message.
 */
function describeSearchError(error: unknown): string {
  if (!isYouTubeApiError(error)) {
    return "Something went wrong while searching. Please try again.";
  }

  switch (error.code) {
    case "quota":
      return "Search is unavailable right now because the YouTube API quota has been reached. Please try again later.";
    case "auth":
      return "Search is not configured correctly right now. Please try again later.";
    case "timeout":
      return "The search took too long. Check your connection and try again.";
    case "network":
      return "Could not reach YouTube. Check your connection and try again.";
    case "bad_request":
    case "not_found":
    case "upstream":
      return "YouTube could not answer this search. Please try again in a moment.";
  }
}
