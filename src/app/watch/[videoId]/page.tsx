import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { getWatchVideo } from "@/features/video";

import { parseWatchVideoId } from "./parse-watch-video-id";
import { WatchPageContent } from "./watch-page-content";

interface WatchPageProps {
  /**
   * Next 16 params are a promise. The page itself never awaits it: it forwards
   * the promise into `<Suspense>` so the breadcrumb stays in the static shell.
   */
  params: Promise<{ videoId: string }>;
}

/** Title comes from the same cached read the page body uses (one request). */
export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  const { videoId } = await params;
  const id = parseWatchVideoId(videoId);

  if (id === null) {
    return { title: "Video not found" };
  }

  const video = await getWatchVideo(id);

  return { title: video?.title ?? "Video not found" };
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
 * Streams while the video resolves. The skeleton mirrors the real two-column
 * layout so nothing shifts when the content arrives.
 */
function WatchPageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Loading video…</span>
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-3/4 max-w-xl sm:h-8" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}
