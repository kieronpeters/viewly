import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VideoCard } from "@/components/video/video-card";
import { listFavouriteVideos } from "@/features/library";

/** The App Router's plain-object view of the URL query string. */
export type LibrarySearchParams = Record<string, string | string[] | undefined>;

/**
 * Tabs the library knows about today.
 *
 * T37 adds history, watch later and playlists; this ticket ships favourites
 * only. Keeping the list typed means the resolver (and its tests) already has
 * the shape T37 extends.
 */
const LIBRARY_TABS = ["favourites"] as const;

export type LibraryTab = (typeof LIBRARY_TABS)[number];

/**
 * Resolves `?tab=` to a known tab.
 *
 * Favourites is the default, so an absent, unknown, stale or duplicated value
 * (`?tab=history`, `?tab=favourites&tab=music`) all land on the favourites
 * list rather than an empty page. Repeated parameters use the first value, the
 * same rule `/category/[slug]` applies to `pageToken`.
 */
export function resolveLibraryTab(value: string | string[] | undefined): LibraryTab {
  const candidate = Array.isArray(value) ? value[0] : value;

  return LIBRARY_TABS.find((tab) => tab === candidate) ?? "favourites";
}

export interface LibraryPageContentProps {
  /** Passed straight through from the page: only this component awaits it. */
  searchParams: Promise<LibrarySearchParams>;
}

/**
 * Dynamic half of `/library`.
 *
 * Awaiting `searchParams` marks this segment as request-time, so the
 * synchronous SQLite read below happens per request inside the page's
 * `<Suspense>` boundary instead of during prerendering. The heading and tab
 * shell stay static.
 */
export async function LibraryPageContent({ searchParams }: LibraryPageContentProps) {
  const params = await searchParams;
  const tab = resolveLibraryTab(params.tab);

  // Favourites is the only tab today; T37 switches on `tab` to pick the list.
  const videos = tab === "favourites" ? listFavouriteVideos() : [];

  return (
    <section aria-labelledby="library-list-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id="library-list-heading"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          Favourites
        </h2>
        <p className="text-sm text-muted-foreground">
          {videos.length === 0
            ? "Videos you save appear here, newest first."
            : `${videos.length} saved ${videos.length === 1 ? "video" : "videos"}, newest first.`}
        </p>
      </div>

      {videos.length === 0 ? (
        <EmptyState
          title="No favourites yet"
          message="Use the heart on any video to save it to your library."
          action={
            <Button asChild variant="outline">
              <Link href="/">Browse videos</Link>
            </Button>
          }
        />
      ) : (
        <ul
          role="list"
          className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {videos.map((video) => (
            <li key={video.id} className="min-w-0">
              <VideoCard video={video} isFavourite className="h-full" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
