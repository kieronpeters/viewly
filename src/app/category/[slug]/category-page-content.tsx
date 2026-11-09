import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { VideoCard } from "@/components/video/video-card";
import { getCategoryBySlug, getCategoryVideos } from "@/features/search/categories";
import type { SearchPage } from "@/shared/types";
import { isDomainValidationError } from "@/shared/validation";

/** The App Router's plain-object view of the URL query string. */
export type CategorySearchParams = Record<string, string | string[] | undefined>;

export interface CategoryPageContentProps {
  /** Passed straight through from the page: only this component awaits it. */
  params: Promise<{ slug: string }>;
  /** Only this component awaits `searchParams`, so the shell stays static. */
  searchParams: Promise<CategorySearchParams>;
}

/**
 * The dynamic half of `/category/[slug]`.
 *
 * Resolves the public slug to its category, then fetches exactly one page of
 * videos through the feature module. Unknown slugs and a `null` page both land
 * on the segment's 404 before anything renders. Read failures are caught here
 * and rendered as authored copy, so a quota error or a bad token never reaches
 * the route-level error boundary.
 *
 * Pagination is link-based: "Load more" advances `?pageToken=` while the slug
 * stays in the path. Like `/search`, each link replaces the current page rather
 * than appending to it.
 */
export async function CategoryPageContent({ params, searchParams }: CategoryPageContentProps) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);

  if (category === null) {
    notFound();
  }

  const pageToken = firstParam((await searchParams).pageToken);

  let page: SearchPage | null;
  try {
    page = await getCategoryVideos(slug, { pageToken });
  } catch (error) {
    return (
      <section aria-labelledby="category-heading" className="flex flex-col gap-4">
        <CategoryHeading name={category.name} />
        <CategoryLoadError slug={slug} pageToken={pageToken} error={error} />
      </section>
    );
  }

  // Unreachable after the lookup above, but the service types it as nullable.
  if (page === null) {
    notFound();
  }

  if (page.items.length === 0) {
    return (
      <section aria-labelledby="category-heading" className="flex flex-col gap-4">
        <CategoryHeading name={category.name} />
        <EmptyState
          title={`No videos in ${category.name} yet`}
          message="This category is empty right now. Try again later or browse another category."
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="category-heading" className="flex flex-col gap-4">
      <CategoryHeading name={category.name} />

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
          <Button asChild variant="outline" size="lg">
            <Link href={categoryHref(slug, page.nextPageToken)} prefetch={false}>
              Load more videos
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}

interface CategoryHeadingProps {
  /** Human-readable category title, never the URL slug. */
  name: string;
}

/** The single `<h1>` for the route; also labels the section landmark. */
function CategoryHeading({ name }: CategoryHeadingProps) {
  return (
    <header className="flex flex-col gap-1">
      <h1
        id="category-heading"
        className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
      >
        {name}
      </h1>
      <p className="text-sm text-muted-foreground">Browse videos in {name}.</p>
    </header>
  );
}

interface CategoryLoadErrorProps {
  /** Slug used to build the recovery link; already validated by the lookup. */
  slug: string;
  /** Raw token from the URL, or null on the first page. */
  pageToken: string | null;
  /** Thrown by the feature module; only its type decides the copy. */
  error: unknown;
}

/**
 * Failure state for the category's video grid.
 *
 * A rejected token can only be recovered by dropping it, so that case links
 * back to the first page. Every other failure retries the same URL. The link
 * alone is enough: the feature call is uncached, so a navigation re-runs it.
 */
function CategoryLoadError({ slug, pageToken, error }: CategoryLoadErrorProps) {
  const invalidToken = isDomainValidationError(error);
  const target =
    invalidToken || pageToken === null ? categoryHref(slug) : categoryHref(slug, pageToken);

  return (
    <div className="flex flex-col items-center gap-3">
      <ErrorState
        title={invalidToken ? "That page link is not valid" : "Could not load this category"}
        message={
          invalidToken
            ? "Start again from the first page of this category."
            : "The videos could not be loaded. Please try again in a moment."
        }
      />
      <Button asChild variant="outline" size="sm">
        <Link href={target} prefetch={false}>
          {invalidToken ? "Back to the first page" : "Try again"}
        </Link>
      </Button>
    </div>
  );
}

/** Builds the browse URL, keeping the slug in the path and the token in the query. */
function categoryHref(slug: string, pageToken: string | null = null): string {
  const path = `/category/${encodeURIComponent(slug)}`;

  if (pageToken === null) {
    return path;
  }

  return `${path}?${new URLSearchParams({ pageToken }).toString()}`;
}

/**
 * Repeated query parameters arrive as an array. The first value is the one a
 * link actually sent, so it wins; the rest are ignored deterministically.
 */
function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
