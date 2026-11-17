import Image from "next/image";
import Link from "next/link";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { FavouriteButton } from "@/components/video/favourite-button";
import { formatRelativeAge } from "@/components/video/format-relative-age";
import { VideoCardMenu } from "@/components/video/video-card-menu";
import { WatchLaterButton } from "@/components/video/watch-later-button";
import { favouriteSnapshotFromVideo } from "@/features/library/favourite-toggle";
import { PlaylistPicker } from "@/features/library/playlist-picker";
import { playlistSnapshotFromVideo, type PlaylistOption } from "@/features/library/playlists";
import { watchLaterSnapshotFromVideo } from "@/features/library/watch-later-toggle";
import {
  isResumableProgress,
  progressPercent,
  type PlaybackPosition,
} from "@/features/progress/progress";
import { cn } from "@/lib/utils";
import { formatDuration, formatViewCount } from "@/shared/format";
import type { VideoSummary } from "@/shared/types";

/**
 * Widths for the responsive grid (1 column, then 2, 3 and 4).
 * Keeping this on the image means the browser downloads a thumbnail close to
 * its rendered width instead of a full-size still.
 */
const THUMBNAIL_SIZES =
  "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

export interface VideoCardProps {
  /** Normalized video summary; never build one from an untrusted payload. */
  video: VideoSummary;
  /** Optional grid-item classes, e.g. a col-span. Layout stays with the parent. */
  className?: string;
  /** Opt-in favourite control (library grids only). */
  isFavourite?: boolean;
  /** Opt-in watch-later control. */
  isWatchLater?: boolean;
  /** Opt-in add-to-playlist control. */
  showPlaylistPicker?: boolean;
  /** Playlists offered by the picker; ignored unless the picker is shown. */
  playlists?: readonly PlaylistOption[];
  /** Local playback progress, or null for a card with no bar. */
  progress?: PlaybackPosition | null;
}

/** First visible character of a channel name, or "?" when there is none. */
function channelInitial(name: string): string {
  const [first] = Array.from(name.trim());
  return first === undefined ? "?" : first.toUpperCase();
}

/**
 * A video card shaped like the observed surface: 16:9 thumbnail with a 12px
 * radius and duration badge, a two-line title, then an avatar row with the
 * channel, views and relative age, plus an overflow menu.
 *
 * The thumbnail and title are one link; the avatar row is plain text so the
 * card keeps a single tab stop for "open the video", and the optional save
 * controls remain siblings of the link. The menu is the second stop.
 */
export function VideoCard({
  video,
  className,
  isFavourite,
  isWatchLater,
  showPlaylistPicker,
  playlists,
  progress,
}: VideoCardProps) {
  const duration = formatDuration(video.durationSeconds);
  const viewCount = formatViewCount(video.viewCount);
  const age = formatRelativeAge(video.publishedAt);
  const meta = [viewCount, age].filter((value): value is string => value !== null).join(" · ");

  const watchedPercent =
    progress !== null &&
    progress !== undefined &&
    isResumableProgress(progress.positionSeconds, progress.durationSeconds)
      ? progressPercent(progress.positionSeconds, progress.durationSeconds)
      : null;
  const hasControls =
    isFavourite !== undefined || isWatchLater !== undefined || showPlaylistPicker === true;

  return (
    <div data-slot="video-card" className={cn("group/card relative min-w-0", className)}>
      <Link
        href={`/watch/${video.id}`}
        aria-label={video.title}
        className={cn("group/link block min-w-0 rounded-xl", FOCUS_RING)}
      >
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
          <Image
            src={video.thumbnailUrl}
            alt=""
            fill
            sizes={THUMBNAIL_SIZES}
            className="object-cover transition-transform duration-300 ease-out group-hover/link:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover/link:scale-100"
          />
          {duration !== null ? (
            <span className="absolute right-1.5 bottom-1.5 rounded bg-background/85 px-1.5 py-0.5 text-xs font-medium text-foreground tabular-nums">
              <span className="sr-only">Duration </span>
              {duration}
            </span>
          ) : null}

          {watchedPercent !== null ? (
            <div
              data-slot="video-card-progress"
              role="progressbar"
              aria-label="Watch progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={watchedPercent}
              className="absolute inset-x-0 bottom-0 h-1 bg-foreground/25"
            >
              <div className="h-full bg-red-600" style={{ width: `${watchedPercent}%` }} />
            </div>
          ) : null}
        </div>

        <h3 className="line-clamp-2 pt-3 text-base leading-[22px] font-medium text-foreground">
          {video.title}
        </h3>
      </Link>

      <div className="mt-1.5 flex min-w-0 items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
        >
          {channelInitial(video.channelTitle)}
        </span>

        <div className="min-w-0 flex-1">
          {video.channelTitle === "" ? null : (
            <p className="truncate text-sm leading-5 text-muted-foreground">{video.channelTitle}</p>
          )}
          {meta === "" ? null : (
            <p className="truncate text-xs leading-5 text-muted-foreground">{meta}</p>
          )}
        </div>

        <VideoCardMenu videoId={video.id} title={video.title} />
      </div>

      {hasControls ? (
        <div
          data-slot="video-card-controls"
          className="absolute top-2 right-2 flex max-w-[calc(100%_-_0.5rem)] items-start justify-end gap-1.5 rounded-full bg-background/80 p-0.5"
        >
          {isFavourite === undefined ? null : (
            <FavouriteButton
              video={favouriteSnapshotFromVideo(video)}
              initialFavourite={isFavourite}
            />
          )}
          {isWatchLater === undefined ? null : (
            <WatchLaterButton
              video={watchLaterSnapshotFromVideo(video)}
              initialInWatchLater={isWatchLater}
            />
          )}
          {showPlaylistPicker === true ? (
            <PlaylistPicker video={playlistSnapshotFromVideo(video)} playlists={playlists ?? []} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
