import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VideoCard } from "@/components/video/video-card";
import { listFavouriteVideos, listPlaylists, listWatchLaterVideos } from "@/features/library";
import { listHistoryEntries, type HistoryEntry } from "@/features/library/history-data";
import { PlaylistCreateForm } from "@/features/library/playlist-create-form";
import type { PlaylistSummary } from "@/shared/types";

import { HistoryClearAllButton, HistoryClearEntryButton } from "./history-clear-controls";

/** The App Router's plain-object view of the URL query string. */
export type LibrarySearchParams = Record<string, string | string[] | undefined>;

/**
 * Tabs the library knows about today.
 *
 * T37 adds the full tabbed shell; T34 introduced watch later, T36 adds the
 * playlists tab with its create form and T35 adds history. Keeping the list
 * typed means the resolver (and its tests) already has the shape T37 extends.
 */
const LIBRARY_TABS = ["favourites", "watch-later", "playlists", "history"] as const;

export type LibraryTab = (typeof LIBRARY_TABS)[number];

/**
 * Resolves `?tab=` to a known tab.
 *
 * Favourites is the default, so an absent, unknown, stale or duplicated value
 * (`?tab=music`, `?tab=favourites&tab=history`) all land on the favourites
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
 * The playlists read happens once per render: the video tabs use it for the
 * card picker, and the playlists tab renders it as the list itself. History
 * returns before that read because its cards have no picker.
 */
function LibraryList({ tab }: LibraryListProps) {
  if (tab === "history") {
    return <HistoryList entries={listHistoryEntries()} />;
  }

  const playlists = listPlaylists();

  if (tab === "playlists") {
    return <PlaylistList playlists={playlists} />;
  }

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
                <VideoCard
                  video={video}
                  isWatchLater
                  showPlaylistPicker
                  playlists={playlists}
                  className="h-full"
                />
              ) : (
                <VideoCard
                  video={video}
                  isFavourite
                  showPlaylistPicker
                  playlists={playlists}
                  className="h-full"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface HistoryListProps {
  /** Newest viewed first, exactly as `listHistoryEntries` returns them. */
  entries: readonly HistoryEntry[];
}

/**
 * Minimal history tab (T35).
 *
 * One card per watched video in "most recently viewed first" order, with the
 * local view count and a two-step remove control under each card, plus one
 * two-step clear-all control for the whole list. Playback writes the rows; this
 * tab only reads and clears them. T37 owns the consolidated tab chrome, so this
 * stays a single section with no tab navigation of its own.
 */
function HistoryList({ entries }: HistoryListProps) {
  return (
    <section aria-labelledby="library-history-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="library-history-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            History
          </h2>
          <p className="text-sm text-muted-foreground">
            {entries.length === 0
              ? "Videos you play are added here automatically, newest first."
              : `${entries.length} watched ${entries.length === 1 ? "video" : "videos"}, newest first.`}
          </p>
        </div>

        {entries.length === 0 ? null : <HistoryClearAllButton count={entries.length} />}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No watch history yet"
          message="Start a video and it will appear here. History is kept on this device."
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
          {entries.map((entry) => (
            <li key={entry.video.id} className="flex min-w-0 flex-col gap-2">
              <VideoCard video={entry.video} />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {entry.viewCount === 1 ? "Watched once" : `Watched ${entry.viewCount} times`}
                </p>
                <HistoryClearEntryButton videoId={entry.video.id} title={entry.video.title} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface PlaylistListProps {
  playlists: readonly PlaylistSummary[];
}

/**
 * Minimal playlists tab: a create form and one row per playlist.
 *
 * T37 owns the real tab system and richer playlist cards. This list only has to
 * be usable today, so it links each name to its detail page and shows the item
 * count the repository already computes.
 */
function PlaylistList({ playlists }: PlaylistListProps) {
  return (
    <section aria-labelledby="library-playlists-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id="library-playlists-heading"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          Playlists
        </h2>
        <p className="text-sm text-muted-foreground">
          {playlists.length === 0
            ? "Group saved videos into playlists on this device."
            : `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}, most recently updated first.`}
        </p>
      </div>

      <PlaylistCreateForm />

      {playlists.length === 0 ? (
        <EmptyState
          title="No playlists yet"
          message="Create a playlist above, then add videos from the watch page or your library."
        />
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <Link
                href={`/library/playlists/${playlist.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground transition-colors outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="font-medium">{playlist.name}</span>
                <span className="text-sm text-muted-foreground">
                  {playlist.itemCount} {playlist.itemCount === 1 ? "video" : "videos"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
