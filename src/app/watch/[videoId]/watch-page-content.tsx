import { notFound } from "next/navigation";

import { FavouriteButton } from "@/components/video/favourite-button";
import { VideoMetadata } from "@/components/video/video-metadata";
import { WatchLaterButton } from "@/components/video/watch-later-button";
import { YoutubePlayer } from "@/components/video/youtube-player";
import { isInWatchLater, isVideoFavourite, listPlaylists } from "@/features/library";
import { favouriteSnapshotFromVideo } from "@/features/library/favourite-toggle";
import { PlaylistPicker } from "@/features/library/playlist-picker";
import { playlistSnapshotFromVideo, type PlaylistOption } from "@/features/library/playlists";
import { watchLaterSnapshotFromVideo } from "@/features/library/watch-later-toggle";
import { getWatchVideo } from "@/features/video";
import type { VideoDetail } from "@/shared/types";

import { parseWatchVideoId } from "./parse-watch-video-id";

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
 * the segment's 404 before anything reaches the player or metadata panel.
 */
export async function WatchPageContent({ params }: WatchPageContentProps) {
  const { videoId } = await params;
  const id = parseWatchVideoId(videoId);

  if (id === null) {
    notFound();
  }

  const video = await getWatchVideo(id);

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
 * Layout half of the watch route: heading, player slot and side panel slot.
 *
 * The player (T30) and the metadata/description panel (T31) each live in their
 * own labelled landmark, so either one can change without disturbing the page
 * structure. The save controls sit in the header, next to the title, and are
 * siblings of the heading text rather than wrappers around it.
 */
export function WatchVideoDetail({
  video,
  isFavourite,
  inWatchLater,
  playlists,
}: WatchVideoDetailProps) {
  return (
    <article aria-labelledby="watch-title" className="flex min-w-0 flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1
            id="watch-title"
            className="text-pretty text-xl font-semibold tracking-tight break-words text-foreground sm:text-2xl lg:text-3xl"
          >
            {video.title}
          </h1>
          {video.channelTitle === "" ? null : (
            <p className="text-sm text-muted-foreground">
              <span className="sr-only">Channel: </span>
              <span>{video.channelTitle}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-start gap-2">
          <FavouriteButton
            video={favouriteSnapshotFromVideo(video)}
            initialFavourite={isFavourite}
            className="shrink-0"
          />
          <WatchLaterButton
            video={watchLaterSnapshotFromVideo(video)}
            initialInWatchLater={inWatchLater}
            className="shrink-0"
          />
          <PlaylistPicker
            video={playlistSnapshotFromVideo(video)}
            playlists={playlists}
            className="shrink-0"
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* T30 slot: the official YouTube embed, with a fallback link. */}
        <section
          data-slot="watch-player-slot"
          aria-labelledby="watch-player-heading"
          className="flex min-w-0 flex-col"
        >
          <h2 id="watch-player-heading" className="sr-only">
            Video player
          </h2>
          <YoutubePlayer videoId={video.id} title={video.title} />
        </section>

        {/* T31 slot: compact metadata and the expandable description. */}
        <aside
          data-slot="watch-details-slot"
          aria-labelledby="watch-details-heading"
          className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4"
        >
          <VideoMetadata video={video} />
        </aside>
      </div>
    </article>
  );
}
