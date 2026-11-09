import Image from "next/image";
import Link from "next/link";

import { FavouriteButton } from "@/components/video/favourite-button";
import { favouriteSnapshotFromVideo } from "@/features/library/favourite-toggle";
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
}

/**
 * A video in a list or grid.
 *
 * The card root is a positioning wrapper, not a link: the title/thumbnail
 * `<Link>` and the optional {@link FavouriteButton} are siblings. That keeps one
 * tab stop for "open the video" plus one for "save the video" without ever
 * nesting a button inside an anchor, which is invalid HTML and unreachable for
 * keyboard and screen-reader users. The duration badge and image stay decorative
 * text inside the link; the control is absolutely positioned over the thumbnail
 * corner when the caller opts in.
 */
export function VideoCard({ video, className, isFavourite }: VideoCardProps) {
  const duration = formatDuration(video.durationSeconds);
  const viewCount = formatViewCount(video.viewCount);

  return (
    <div data-slot="video-card" className={cn("relative min-w-0", className)}>
      <Link
        href={`/watch/${video.id}`}
        className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-card text-card-foreground transition-colors outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          <Image
            src={video.thumbnailUrl}
            alt={video.title}
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

      {isFavourite === undefined ? null : (
        <div className="absolute top-2 right-2">
          <FavouriteButton
            video={favouriteSnapshotFromVideo(video)}
            initialFavourite={isFavourite}
          />
        </div>
      )}
    </div>
  );
}
