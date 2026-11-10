import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { VideoCard } from "@/components/video/video-card";
import {
  countLibraryEntries,
  listFavouriteVideos,
  listPlaylists,
  listWatchLaterVideos,
  sweepLibraryMetadata,
} from "@/features/library";
import { listHistoryEntries, type HistoryEntry } from "@/features/library/history-data";
import { PlaylistCreateForm } from "@/features/library/playlist-create-form";
import { listContinueWatchingVideos } from "@/features/progress/continue-watching";
import {
  ContinueWatchingShelf,
  type ContinueWatchingShelfProps,
} from "@/features/progress/continue-watching-section";
import { listVideoProgress } from "@/features/progress/progress-data";
import type { VideoProgress } from "@/features/progress/progress";
import { cn } from "@/lib/utils";
import type { PlaylistSummary } from "@/shared/types";

import { HistoryClearAllButton, HistoryClearEntryButton } from "./history-clear-controls";
import { LibraryTabs, resolveLibraryTab, type LibraryTab } from "./library-tabs";

/** The App Router's plain-object view of the URL query string. */
export type LibrarySearchParams = Record<string, string | string[] | undefined>;

export interface LibraryPageContentProps {
  /** Passed straight through from the page: only this component awaits it. */
  searchParams: Promise<LibrarySearchParams>;
}

/**
 * Dynamic half of `/library`.
 *
 * Awaiting `searchParams` marks this segment as request-time, so the
 * synchronous SQLite reads below happen per request inside the page's
 * `<Suspense>` boundary instead of during prerendering. The heading stays in
 * the static shell; the tab bar and the active list render here because both
 * depend on `?tab=`.
 *
 * Switching tabs is a navigation, so only the newly active tab's list is read.
 * The four tab counts are separate `COUNT(*)` queries (`countLibraryEntries`),
 * never list reads: a tab that is not open must not be loaded to size it.
 *
 * One cross-tab "Continue watching" shelf sits above the tabs. It reads the
 * local progress join once per request and hides itself when nothing is in
 * progress; like the tabs it costs no YouTube call.
 *
 * The lazy 30-day metadata sweep (T46) runs before the list read, so the cards
 * below never render a snapshot that the sweep was about to replace. It is
 * awaited inside the same `<Suspense>` boundary, so a slow or failed sweep
 * delays or leaves the list as-is rather than breaking the page; the sweep
 * itself never throws.
 */
export async function LibraryPageContent({ searchParams }: LibraryPageContentProps) {
  const params = await searchParams;

  await sweepLibraryMetadata();

  const tab = resolveLibraryTab(params.tab);
  const counts = countLibraryEntries();

  // The shelf spans every tab, so it is read once here. A failed local read
  // hides it rather than replacing the whole library with an error; the tab
  // list below still renders from its own reads.
  let continueWatching: ContinueWatchingShelfProps["items"] = [];
  try {
    continueWatching = await listContinueWatchingVideos();
  } catch {
    continueWatching = [];
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
       * Cross-tab local shelf: every in-progress video that has a stored
       * snapshot, independent of the active tab. It renders nothing when the
       * list is empty, so an untouched library looks exactly as before.
       */}
      <ContinueWatchingShelf
        items={continueWatching}
        titleId="library-continue-watching-heading"
        layout="grid"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <LibraryTabs activeTab={tab} counts={counts} />
        {/*
         * The stats page is a separate route rather than a `?tab=` value: it is
         * a report over every list, not another slice of the library. Keeping
         * it beside the tabs still makes it discoverable from the page that
         * owns the data, without adding an item to the app shell.
         */}
        <div className="flex flex-wrap items-center gap-2">
          {/*
           * Backup & restore sits beside the stats link rather than in the tab
           * bar: it is a data-management page, not another slice of the library.
           * Both links keep the 44px minimum target and the shared focus ring.
           */}
          <Link
            href="/library/backup"
            className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-surface-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Backup &amp; restore
          </Link>
          <Link
            href="/library/stats"
            className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-surface-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Watch stats
          </Link>
        </div>
      </div>
      <LibraryList tab={tab} />
    </div>
  );
}

interface LibraryListProps {
  tab: LibraryTab;
}

/**
 * The list for one resolved tab.
 *
 * Only the active tab's list is read, plus the playlist list when the cards
 * need a picker (the video tabs and the playlists tab itself). History returns
 * before that read because its cards have no picker. The tab bar's counts come
 * from `countLibraryEntries`, not from these lists.
 */
function LibraryList({ tab }: LibraryListProps) {
  if (tab === "history") {
    const entries = listHistoryEntries();
    const progressById = listVideoProgress(entries.map((entry) => entry.video.id));

    return <HistoryList entries={entries} progressById={progressById} />;
  }

  const playlists = listPlaylists();

  if (tab === "playlists") {
    return <PlaylistList playlists={playlists} />;
  }

  const isWatchLater = tab === "watch-later";
  const videos = isWatchLater ? listWatchLaterVideos() : listFavouriteVideos();
  // One batched read for the whole tab; videos without a row get no bar.
  const progressById = listVideoProgress(videos.map((video) => video.id));
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
            <Button asChild variant="outline" className="min-h-11">
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
                  progress={progressById.get(video.id) ?? null}
                  className="h-full"
                />
              ) : (
                <VideoCard
                  video={video}
                  isFavourite
                  showPlaylistPicker
                  playlists={playlists}
                  progress={progressById.get(video.id) ?? null}
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
  /** Local playback progress keyed by video id; absent entries have no bar. */
  progressById: ReadonlyMap<string, VideoProgress>;
}

/**
 * Minimal history tab (T35).
 *
 * One card per watched video in "most recently viewed first" order, with the
 * local view count and a two-step remove control under each card, plus one
 * two-step clear-all control for the whole list. Playback writes the rows; this
 * tab only reads and clears them. The tab navigation lives in `<LibraryTabs>`,
 * above every tab's content.
 */
function HistoryList({ entries, progressById }: HistoryListProps) {
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
            <Button asChild variant="outline" className="min-h-11">
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
              <VideoCard video={entry.video} progress={progressById.get(entry.video.id) ?? null} />

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
 * Playlists tab: a create form and one row per playlist.
 *
 * T37 owns the tab chrome above it. This list links each name to its detail
 * page and shows the item count the repository already computes.
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
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground transition-[background-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-0.5 hover:bg-surface-elevated hover:shadow-md hover:shadow-background/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                  FOCUS_RING,
                )}
              >
                <span className="min-w-0 font-medium break-words">{playlist.name}</span>
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
