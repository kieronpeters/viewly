import Image from "next/image";
import Link from "next/link";

import { FavouriteButton } from "@/components/video/favourite-button";
import { WatchLaterButton } from "@/components/video/watch-later-button";
import { favouriteSnapshotFromVideo } from "@/features/library/favourite-toggle";
import { PlaylistPicker } from "@/features/library/playlist-picker";
import { playlistSnapshotFromVideo, type PlaylistOption } from "@/features/library/playlists";
import { watchLaterSnapshotFromVideo } from "@/features/library/watch-later-toggle";
import { cn } from "@/lib/utils";
import { formatDuration, formatViewCount } from "@/shared/format";
import type { VideoSummary } from "@/shared/types";

/**
 * Widths for a 1/2/3/4 column grid (below 640px, 640px, 1024px, 1280px).
 * Keeping this on the image means the browser downloads a thumbnail that is
 * close to its rendered width instead of a full-size still.
 */
const THUMBNAIL_SIZES =
  "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

export interface VideoCardProps {
  /** Normalized video summary; never build one from an untrusted payload. */
  video: VideoSummary;
  /** Optional grid-item classes, e.g. a col-span. Layout stays with the parent. */
  className?: string;
  /**
   * Opt-in favourite control.
   *
   * Omit the prop for the plain card used by home, search and category grids.
   * Pass the server-read saved state (`true` / `false`) to render the toggle;
   * the card itself never queries the database.
   */
  isFavourite?: boolean;
  /**
   * Opt-in watch-later control.
   *
   * Omitted independently of {@link isFavourite}, so a grid can show either
   * control, both, or neither without changing the plain card.
   */
  isWatchLater?: boolean;
  /**
   * Opt-in add-to-playlist control.
   *
   * Discovery grids leave this off, so the card they render is unchanged. The
   * library passes `true` together with {@link playlists}; the picker itself
   * stays a Client Component and never queries the database.
   */
  showPlaylistPicker?: boolean;
  /** Playlists offered by the picker; ignored unless the picker is shown. */
  playlists?: readonly PlaylistOption[];
}

/**
 * A video in a list or grid.
 *
 * The card root is a positioning wrapper, not a link: the title/thumbnail
 * `<Link>` and the optional controls are siblings. That keeps one tab stop for
 * "open the video" plus one per control without ever nesting a button inside an
 * anchor, which is invalid HTML and unreachable for keyboard and screen-reader
 * users. The duration badge and image stay decorative text inside the link; the
 * controls are absolutely positioned over the thumbnail corner when the caller
 * opts in.
 *
 * DOM order is link, favourite, watch later, playlist, so the tab sequence is
 * stable whether one or more controls are rendered. The buttons sit in a flex
 * row with a gap, and each control's inline error stacks underneath its own
 * button.
 *
 * The thumbnail is decorative: the adjacent `<h3>` already names the video and
 * both sit inside the same link, so an `alt` equal to the title would repeat
 * the link's name twice. `alt=""` keeps the image out of the accessibility tree
 * while the visible duration badge stays part of the link text.
 */
export function VideoCard({
  video,
  className,
  isFavourite,
  isWatchLater,
  showPlaylistPicker,
  playlists,
}: VideoCardProps) {
  const duration = formatDuration(video.durationSeconds);
  const viewCount = formatViewCount(video.viewCount);
  const hasControls =
    isFavourite !== undefined || isWatchLater !== undefined || showPlaylistPicker === true;

  return (
    <div data-slot="video-card" className={cn("relative min-w-0", className)}>
      {/*
        The link contains the thumbnail, duration, title, channel and view
        count, so its computed name would start with the duration badge. Name
        the destination explicitly; the visible text stays readable in browse
        mode and the label still contains the visible title (Label in Name).
      */}
      <Link
        href={`/watch/${video.id}`}
        aria-label={video.title}
        className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-card text-card-foreground transition-colors outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          <Image
            src={video.thumbnailUrl}
            alt=""
            fill
            sizes={THUMBNAIL_SIZES}
            className="object-cover"
          />
          {duration !== null ? (
            <span className="absolute right-1.5 bottom-1.5 rounded bg-background/85 px-1.5 py-0.5 text-xs font-medium text-foreground tabular-nums">
              <span className="sr-only">Duration </span>
              {duration}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1 p-3">
          <h3 className="line-clamp-2 text-sm leading-snug font-medium">{video.title}</h3>
          {video.channelTitle !== "" ? (
            <p className="truncate text-xs text-muted-foreground">{video.channelTitle}</p>
          ) : null}
          {viewCount !== null ? <p className="text-xs text-muted-foreground">{viewCount}</p> : null}
        </div>
      </Link>

      {hasControls ? (
        <div
          data-slot="video-card-controls"
          className="absolute top-2 right-2 flex max-w-[calc(100%_-_0.5rem)] items-start justify-end gap-1.5"
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
