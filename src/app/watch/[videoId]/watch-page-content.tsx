import { CircleUserRound, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FavouriteButton } from "@/components/video/favourite-button";
import { WatchLaterButton } from "@/components/video/watch-later-button";
import { isInWatchLater, isVideoFavourite, listPlaylists } from "@/features/library";
import { favouriteSnapshotFromVideo } from "@/features/library/favourite-toggle";
import { PlaylistPicker } from "@/features/library/playlist-picker";
import { playlistSnapshotFromVideo, type PlaylistOption } from "@/features/library/playlists";
import { videoSnapshotFromVideo } from "@/features/library/video-snapshot";
import { watchLaterSnapshotFromVideo } from "@/features/library/watch-later-toggle";
import type { VideoDetail } from "@/shared/types";

import { CopyLinkButton } from "./copy-link-button";
import { parseWatchVideoId } from "./parse-watch-video-id";
import { readWatchVideo } from "./read-watch-video";
import { WatchConfigurationState } from "./watch-configuration-state";
import { WatchDescription } from "./watch-description";
import { WatchDiscussion } from "./watch-discussion";
import { WatchPlayer } from "./watch-player";
import { WatchSuggestions, WatchSuggestionsSkeleton } from "./watch-suggestions";

export interface WatchPageContentProps {
  /** Next 16 passes `params` as a promise; only this boundary awaits it. */
  params: Promise<{ videoId: string }>;
}

/**
 * Data half of the watch route.
 *
 * Runs inside the page's `<Suspense>` boundary: it awaits the runtime `params`
 * and the uncached `getWatchVideo` read, so the breadcrumb and skeleton stay in
 * the prerendered shell. Invalid ids and unknown/private videos both resolve to
 * the segment's 404 before anything reaches the player or the page detail.
 *
 * A missing YouTube API key is not a 404 and not a crash: `readWatchVideo`
 * reports it as a value and this component renders an authored setup state.
 * Genuine failures are rethrown, so the route's error boundary still handles
 * them.
 */
export async function WatchPageContent({ params }: WatchPageContentProps) {
  const { videoId } = await params;
  const id = parseWatchVideoId(videoId);

  if (id === null) {
    notFound();
  }

  const read = await readWatchVideo(id);

  if (read.status === "configuration_error") {
    return <WatchConfigurationState />;
  }

  const { video } = read;

  if (video === null) {
    notFound();
  }

  // Read behind the page's `<Suspense>` boundary, next to `params`, so the
  // static shell can prerender while the saved state resolves per request.
  const isFavourite = isVideoFavourite(video.id);
  const inWatchLater = isInWatchLater(video.id);
  const playlists = listPlaylists();

  return (
    <WatchVideoDetail
      video={video}
      isFavourite={isFavourite}
      inWatchLater={inWatchLater}
      playlists={playlists}
    />
  );
}

export interface WatchVideoDetailProps {
  /** Already normalized by the YouTube client; never built from a raw payload. */
  video: VideoDetail;
  /** Server-read saved state for the video, so the control hydrates correctly. */
  isFavourite: boolean;
  /** Server-read watch-later state for the video. */
  inWatchLater: boolean;
  /** Playlists offered by the add-to-playlist picker. */
  playlists: readonly PlaylistOption[];
}

/**
 * Layout half of the watch route: a player-led column and a sticky "Up next"
 * rail, arranged like YouTube.
 *
 * Desktop (`lg+`) puts the player, title, channel/actions, description and
 * comments/notes in a flexible left column with a 360px suggestions rail beside
 * it. The rail is `position: sticky`, so it stays in view while the description
 * and discussion scroll. On smaller screens the grid collapses to one column in
 * DOM order: player, title, actions, description, comments/notes, then the
 * related videos. That is the order the requirements ask for and it means the
 * page needs no duplicated suggestions markup for the two breakpoints.
 *
 * The player slot still renders {@link WatchPlayer} unchanged; T67 owns the
 * embed behind it. The description and discussion are separate labelled
 * regions so T74/T79/T80 can replace their contents without touching the
 * layout.
 */
export function WatchVideoDetail({
  video,
  isFavourite,
  inWatchLater,
  playlists,
}: WatchVideoDetailProps) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;

  return (
    <article aria-labelledby="watch-title" className="flex min-w-0 flex-col">
      <div className="grid min-w-0 grid-cols-1 items-start gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        {/* Primary column: playback, then everything a viewer reads or acts on. */}
        <div className="flex min-w-0 flex-col gap-4">
          <section
            data-slot="watch-player-slot"
            aria-labelledby="watch-player-heading"
            className="flex min-w-0 flex-col"
          >
            <h2 id="watch-player-heading" className="sr-only">
              Video player
            </h2>
            <WatchPlayer snapshot={videoSnapshotFromVideo(video)} />
          </section>

          <div className="flex min-w-0 flex-col gap-3">
            <h1
              id="watch-title"
              className="text-pretty text-xl font-semibold tracking-tight break-words text-foreground sm:text-2xl"
            >
              {video.title}
            </h1>

            {/*
              One row on desktop, two stacked rows below `sm`: the channel
              identity (with the outbound link) and the video actions. No
              subscriber count is shown because the source does not provide one.
            */}
            <div
              data-slot="watch-channel-row"
              className="flex min-w-0 flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground"
                >
                  <CircleUserRound className="size-6" />
                </span>

                <div className="flex min-w-0 flex-col">
                  {video.channelTitle === "" ? null : (
                    <p className="text-sm font-medium break-words text-foreground">
                      <span className="sr-only">Channel: </span>
                      {video.channelTitle}
                    </p>
                  )}
                  <a
                    href={youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    View on YouTube
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              </div>

              <div
                data-slot="watch-action-row"
                role="group"
                aria-label="Video actions"
                className="flex shrink-0 flex-wrap items-start justify-end gap-2"
              >
                <FavouriteButton
                  video={favouriteSnapshotFromVideo(video)}
                  initialFavourite={isFavourite}
                />
                <WatchLaterButton
                  video={watchLaterSnapshotFromVideo(video)}
                  initialInWatchLater={inWatchLater}
                />
                <PlaylistPicker video={playlistSnapshotFromVideo(video)} playlists={playlists} />
                <CopyLinkButton videoId={video.id} />
              </div>
            </div>

            <WatchDescription video={video} />

            <WatchDiscussion videoId={video.id} />
          </div>
        </div>

        {/* Right rail on desktop; below the discussion in the mobile stack. */}
        <aside
          data-slot="watch-up-next-slot"
          aria-label="Suggested videos"
          className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
        >
          <Suspense fallback={<WatchSuggestionsSkeleton />}>
            <WatchSuggestions channelTitle={video.channelTitle} currentVideoId={video.id} />
          </Suspense>
        </aside>
      </div>
    </article>
  );
}
