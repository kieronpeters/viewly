import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FavouriteButton } from "@/components/video/favourite-button";
import { WatchLaterButton } from "@/components/video/watch-later-button";
import { WatchQueue } from "@/components/video/watch-queue";
import { isInWatchLater, isVideoFavourite, listPlaylists } from "@/features/library";
import { favouriteSnapshotFromVideo } from "@/features/library/favourite-toggle";
import { PlaylistPicker } from "@/features/library/playlist-picker";
import { playlistSnapshotFromVideo, type PlaylistOption } from "@/features/library/playlists";
import { videoSnapshotFromVideo } from "@/features/library/video-snapshot";
import { watchLaterSnapshotFromVideo } from "@/features/library/watch-later-toggle";
import { getVideoProgress } from "@/features/progress/progress-data";
import type { VideoProgress } from "@/features/progress/progress";
import type { ChannelDetail, VideoDetail } from "@/shared/types";

import { CopyLinkButton } from "./copy-link-button";
import { parseWatchVideoId } from "./parse-watch-video-id";
import { readWatchChannel } from "./read-watch-channel";
import { readWatchVideo } from "./read-watch-video";
import { WatchChannelCard } from "./watch-channel-card";
import { WatchConfigurationState } from "./watch-configuration-state";
import { WatchDescription } from "./watch-description";
import { WatchDiscussion } from "./watch-discussion";
import { WatchPlayerColumn } from "./watch-player-column";
import { WatchStageLayout } from "./watch-stage-layout";
import { WatchSuggestions, WatchSuggestionsSkeleton } from "./watch-suggestions";
import { WatchTheaterProvider } from "./watch-theater";

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
  // Local playback position for the resume prompt (T68), read per request
  // beside the other SQLite reads.
  const progress = getVideoProgress(video.id);
  // Optional enrichment: null on any failure, never thrown (T74).
  const channel = await readWatchChannel(video.channelId);

  return (
    <WatchVideoDetail
      video={video}
      channel={channel}
      isFavourite={isFavourite}
      inWatchLater={inWatchLater}
      playlists={playlists}
      progress={progress}
    />
  );
}

export interface WatchVideoDetailProps {
  /** Already normalized by the YouTube client; never built from a raw payload. */
  video: VideoDetail;
  /**
   * Channel card metadata, or null when `channels.list` was unavailable. The
   * card falls back to the snippet's channel name, so the header never goes blank.
   */
  channel: ChannelDetail | null;
  /** Server-read saved state for the video, so the control hydrates correctly. */
  isFavourite: boolean;
  /** Server-read watch-later state for the video. */
  inWatchLater: boolean;
  /** Playlists offered by the add-to-playlist picker. */
  playlists: readonly PlaylistOption[];
  /** Local playback progress, or null when the video was never started. */
  progress: VideoProgress | null;
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
 * The player slot renders the client player column (T86), which owns the
 * listen-mode preference and activates the shell player (T75); T67 owns the
 * embed behind it. Theater mode (T70) is shared through `WatchTheaterProvider`:
 * the grid and rail are one client layout boundary, while the description and
 * discussion remain server-rendered children that never remount on a toggle.
 * The seek channel (T71) is provided by the shell, beside the one shared
 * player, so a timestamp or chapter click drives that player without a second
 * embed or a navigation. The description and discussion are separate labelled
 * regions so T74/T79/T80 can replace their contents without touching the
 * layout.
 */
export function WatchVideoDetail({
  video,
  channel,
  isFavourite,
  inWatchLater,
  playlists,
  progress,
}: WatchVideoDetailProps) {
  return (
    <WatchTheaterProvider>
      <article aria-labelledby="watch-title" className="flex min-w-0 flex-col">
        {/*
          The grid is a client boundary because theater mode (T70) changes how
          the two columns share the width. Its children stay server-rendered;
          the rail is passed as a node so hiding it in theater mode keeps the
          suggestions and queue mounted instead of refetching them.
        */}
        <WatchStageLayout
          rail={
            <div className="flex min-w-0 flex-col gap-5">
              <Suspense fallback={<WatchSuggestionsSkeleton />}>
                <WatchSuggestions channelTitle={video.channelTitle} currentVideoId={video.id} />
              </Suspense>
              {/* The queue is local, so it renders immediately instead of waiting
                  behind the suggestions request and its Suspense boundary. */}
              <WatchQueue currentVideoId={video.id} />
            </div>
          }
        >
          {/*
            Primary column: playback, then everything a viewer reads or acts on.
            The client wrapper owns listen mode (T86), so the meta block below can
            be replaced by the compact bar without remounting the description,
            chapters or discussion. The seek channel (T71) and the single player
            belong to the shell (T75), which is why this route no longer provides
            either: description timestamps reach the same embed from any route.
          */}
          <WatchPlayerColumn
            snapshot={videoSnapshotFromVideo(video)}
            initialProgress={progress}
            meta={
              <>
                <h1
                  id="watch-title"
                  className="text-pretty text-xl font-semibold tracking-tight break-words text-foreground sm:text-2xl"
                >
                  {video.title}
                </h1>

                {/*
                  One row on desktop, two stacked rows below `sm`: the channel card
                  (avatar, name, outbound link) and the video actions. The card owns
                  its own fallbacks, so this row renders even when `channels.list`
                  was unavailable.
                */}
                <div
                  data-slot="watch-channel-row"
                  className="flex min-w-0 flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <WatchChannelCard
                    channel={channel}
                    channelTitle={video.channelTitle}
                    videoId={video.id}
                    channelId={video.channelId}
                  />

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
                    <PlaylistPicker
                      video={playlistSnapshotFromVideo(video)}
                      playlists={playlists}
                    />
                    <CopyLinkButton videoId={video.id} />
                  </div>
                </div>
              </>
            }
          >
            <WatchDescription video={video} />

            <WatchDiscussion videoId={video.id} />
          </WatchPlayerColumn>
        </WatchStageLayout>
      </article>
    </WatchTheaterProvider>
  );
}
