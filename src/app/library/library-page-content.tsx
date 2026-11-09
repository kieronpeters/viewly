import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VideoCard } from "@/components/video/video-card";
import { listFavouriteVideos, listWatchLaterVideos } from "@/features/library";

/** The App Router's plain-object view of the URL query string. */
export type LibrarySearchParams = Record<string, string | string[] | undefined>;

/**
 * Tabs the library knows about today.
 *
 * T37 adds history and playlists; T34 introduces watch later next to the
 * favourites default. Keeping the list typed means the resolver (and its tests)
 * already has the shape T37 extends.
 */
const LIBRARY_TABS = ["favourites", "watch-later"] as const;

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

  return <LibraryList tab={tab} />;
}

interface LibraryListProps {
  tab: LibraryTab;
}

/**
 * The list for one resolved tab.
 *
 * T37 replaces this small switch with the full tabbed page; until then each tab
 * reads its own repository list and renders the matching control on every card.
 */
function LibraryList({ tab }: LibraryListProps) {
  const isWatchLater = tab === "watch-later";
  const videos = isWatchLater ? listWatchLaterVideos() : listFavouriteVideos();
  const heading = isWatchLater ? "Watch later" : "Favourites";
  const description = isWatchLater
    ? "Videos you queue appear here, newest first."
    : "Videos you save appear here, newest first.";

  return (
    <section aria-labelledby="library-list-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id="library-list-heading"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          {heading}
        </h2>
        <p className="text-sm text-muted-foreground">
          {videos.length === 0
            ? description
            : `${videos.length} ${isWatchLater ? "queued" : "saved"} ${
                videos.length === 1 ? "video" : "videos"
              }, newest first.`}
        </p>
      </div>

      {videos.length === 0 ? (
        <EmptyState
          title={isWatchLater ? "No videos in Watch Later yet" : "No favourites yet"}
          message={
            isWatchLater
              ? "Use the clock on any video to queue it for later."
              : "Use the heart on any video to save it to your library."
          }
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
              {isWatchLater ? (
                <VideoCard video={video} isWatchLater className="h-full" />
              ) : (
                <VideoCard video={video} isFavourite className="h-full" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
