import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { CategoryPageContent, type CategorySearchParams } from "./category-page-content";

export const metadata: Metadata = {
  title: "Browse category · Viewly",
  description: "Browse videos in a category.",
};

/** Number of placeholder cards; eight fills a wide grid without a second row gap. */
const PLACEHOLDER_COUNT = 8;

export interface CategoryPageProps {
  /**
   * Next 16 runtime API: a promise resolved per request. The shell never awaits
   * it; `<CategoryPageContent>` does, inside `<Suspense>`.
   */
  params: Promise<{ slug: string }>;
  /** Optional `?pageToken=` continuation, awaited by the content half only. */
  searchParams: Promise<CategorySearchParams>;
}

/**
 * `/category/[slug]` route shell.
 *
 * The shell itself reads no request data, so the back link and the loading
 * skeleton are part of the prerendered static shell. Both runtime APIs
 * (`params` and `searchParams`) are forwarded untouched into `<Suspense>`,
 * which is the boundary Cache Components requires for request-time data.
 *
 * The slug is resolved and the videos are fetched in `<CategoryPageContent>`;
 * this file only composes the route.
 */
export default function CategoryPage({ params, searchParams }: CategoryPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to home
        </Link>
      </nav>

      <Suspense fallback={<CategoryPageSkeleton />}>
        <CategoryPageContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * Streams while the category resolves. The skeleton mirrors the real heading
 * and `VideoCard` grid so nothing shifts when the content arrives. `Skeleton`
 * is decorative, so the grid is `aria-hidden` and one hidden status announces
 * the wait.
 */
function CategoryPageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Loading category…</span>
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
