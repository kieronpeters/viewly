import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";

import { parseWatchVideoId } from "./parse-watch-video-id";
import { readWatchVideo } from "./read-watch-video";
import { WatchPageContent } from "./watch-page-content";

interface WatchPageProps {
  /**
   * Next 16 params are a promise. The page itself never awaits it: it forwards
   * the promise into `<Suspense>` so the breadcrumb stays in the static shell.
   */
  params: Promise<{ videoId: string }>;
}

/**
 * Title comes from the same cached read the page body uses (one request).
 *
 * A missing API key must not throw here: an exception in `generateMetadata`
 * fails the whole route in dev and replaces the page with the generic error
 * boundary in production, which is exactly the state T47 fixes. The read
 * helper catches `EnvConfigurationError` and returns a neutral title instead;
 * every other failure still propagates.
 */
export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  const { videoId } = await params;
  const id = parseWatchVideoId(videoId);

  if (id === null) {
    return { title: "Video not found" };
  }

  const read = await readWatchVideo(id);

  if (read.status === "configuration_error") {
    // Deliberately neutral: the setup explanation lives in the page body, not
    // in the tab title, so metadata never carries configuration detail.
    return { title: "Video unavailable" };
  }

  return { title: read.video?.title ?? "Video not found" };
}

/**
 * `/watch/[videoId]` route shell.
 *
 * Everything here is static: breadcrumb, page container and the loading
 * skeleton. The runtime `params` read and the uncached `getWatchVideo` call live
 * in `<WatchPageContent>`, inside `<Suspense>`, which is the boundary Cache
 * Components requires for request-time data.
 */
export default function WatchPage({ params }: WatchPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-[112rem] flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:px-8">
      <WatchBreadcrumb />

      <Suspense fallback={<WatchPageSkeleton />}>
        <WatchPageContent params={params} />
      </Suspense>
    </div>
  );
}

/** Home is the only built context today; the search page can be added here later. */
function WatchBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to home
          </Link>
        </li>
        <li aria-hidden="true" className="text-muted-foreground">
          /
        </li>
        <li aria-current="page" className="text-muted-foreground">
          Watch
        </li>
      </ol>
    </nav>
  );
}

/**
 * Streams while the video resolves. The skeleton mirrors the real player-led
 * layout — a wide left column and the sticky "Up next" rail — so nothing shifts
 * when the content arrives.
 */
function WatchPageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Loading video…</span>
      <div
        aria-hidden="true"
        className="grid min-w-0 grid-cols-1 items-start gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22.5rem]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-3/4 max-w-xl sm:h-8" />
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <Skeleton className="h-10 w-44 rounded-full" />
              <Skeleton className="h-11 w-52 rounded-full" />
            </div>
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex min-w-0 gap-2 p-1.5">
              <Skeleton className="aspect-video w-40 shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
