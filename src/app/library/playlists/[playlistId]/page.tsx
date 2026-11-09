import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { PlaylistPageContent } from "./playlist-page-content";

export const metadata: Metadata = {
  title: "Playlist · Viewly",
  description: "One of your saved-video playlists, kept on this device.",
};

export interface PlaylistPageProps {
  /**
   * Next 16 runtime API: a promise resolved per request. The shell never awaits
   * it; `<PlaylistPageContent>` does, inside `<Suspense>`.
   */
  params: Promise<{ playlistId: string }>;
}

/**
 * `/library/playlists/[playlistId]` route shell.
 *
 * The breadcrumb and loading skeleton are static. The `params` read, the SQLite
 * lookup and the single `getVideos` batch live in `<PlaylistPageContent>`, which
 * is the request-time boundary Cache Components requires.
 */
export default function PlaylistPage({ params }: PlaylistPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          <li>
            <Link
              href="/library?tab=playlists"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Library
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted-foreground">
            /
          </li>
          <li aria-current="page" className="text-muted-foreground">
            Playlist
          </li>
        </ol>
      </nav>

      <Suspense fallback={<PlaylistPageSkeleton />}>
        <PlaylistPageContent params={params} />
      </Suspense>
    </div>
  );
}

/** Streams while the playlist and its video metadata resolve. */
function PlaylistPageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading playlist…</span>
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {Array.from({ length: 4 }, (_, index) => (
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
