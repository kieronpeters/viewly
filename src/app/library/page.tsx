import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { LibraryPageContent, type LibrarySearchParams } from "./library-page-content";

export const metadata: Metadata = {
  title: "Library · Viewly",
  description: "Your saved videos, kept on this device.",
};

/** Number of placeholder cards; eight fills a wide grid without a second row gap. */
const PLACEHOLDER_COUNT = 8;

export interface LibraryPageProps {
  /**
   * Next 16 runtime API: a promise resolved per request. The shell never awaits
   * it; `<LibraryPageContent>` does, inside `<Suspense>`.
   */
  searchParams: Promise<LibrarySearchParams>;
}

/**
 * `/library` route shell.
 *
 * The heading is part of the prerendered static shell. The `?tab=` read and the
 * synchronous SQLite query live in `<LibraryPageContent>`, inside `<Suspense>`,
 * which is the boundary Cache Components requires for request-time data.
 *
 * Today the page lists favourites, watch later or playlists depending on
 * `?tab=`. T37 extends the same shell with the full tabbed page; the resolver in
 * the content half already accepts `?tab=`.
 */
export default function LibraryPage({ searchParams }: LibraryPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Library
        </h1>
        <p className="text-sm text-muted-foreground">
          Videos you save are kept on this device, newest first.
        </p>
      </header>

      <Suspense fallback={<LibraryPageSkeleton />}>
        <LibraryPageContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * Streams while the favourites list resolves. The skeleton mirrors the real
 * heading and card grid so nothing shifts when the content arrives. `Skeleton`
 * is decorative, so the grid is `aria-hidden` and one hidden status announces
 * the wait.
 */
function LibraryPageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading library…</span>
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
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
