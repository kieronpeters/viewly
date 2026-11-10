import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { StatsPageContent } from "./stats-page-content";

export const metadata: Metadata = {
  title: "Watch stats · Viewly",
  description: "Estimated watch time, top channels and streaks from your local history.",
};

/** Placeholder squares that keep the heatmap's footprint stable while it loads. */
const HEATMAP_PLACEHOLDER_DAYS = 84;

/**
 * `/library/stats` route shell (T85).
 *
 * The heading, description and back link are part of the static shell. The
 * aggregates run in `<StatsPageContent>` inside `<Suspense>`; that component
 * calls `io()` before the synchronous SQLite read, which is what Cache
 * Components requires to keep the numbers out of the prerendered shell.
 *
 * This route lives under `/library` so the existing shell highlights the
 * Library destination and the page is reachable from the library header.
 */
export default function WatchStatsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/library"
          className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          ← Back to library
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Watch stats
        </h1>
        <p className="text-sm text-muted-foreground">
          Estimated watch time and activity from the history kept on this device.
        </p>
      </header>

      <Suspense fallback={<StatsPageSkeleton />}>
        <StatsPageContent />
      </Suspense>
    </div>
  );
}

/**
 * Streams while the aggregates resolve. Shapes mirror the real overview cards,
 * channel rows and heatmap, and one hidden status announces the wait.
 */
function StatsPageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-8">
      <span className="sr-only">Loading watch stats…</span>

      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-28" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-36" />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-xl" />
        ))}
      </div>

      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-flow-col grid-rows-7 gap-1">
          {Array.from({ length: HEATMAP_PLACEHOLDER_DAYS }, (_, index) => (
            <Skeleton key={index} className="size-3 rounded-[2px] sm:size-4" />
          ))}
        </div>
      </div>
    </div>
  );
}
