import Image from "next/image";
import Link from "next/link";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { RelativeAge } from "@/components/video/relative-age";
import { VideoCardMenu } from "@/components/video/video-card-menu";
import { cn } from "@/lib/utils";
import { formatDuration, formatViewCount } from "@/shared/format";
import type { VideoSummary } from "@/shared/types";

const THUMBNAIL_SIZES = "(min-width: 1024px) 500px, (min-width: 640px) 360px, 100vw";

/**
 * A search result, shaped like the observed wide row: a large 16:9 thumbnail
 * with the text column beside it on wide screens, collapsing to a stacked card
 * below `sm`. Thumbnail, title, metadata and channel form one link, so a row
 * has one tab stop for "open the video" plus the overflow menu.
 *
 * The observed row also carries a two-line snippet description, which Viewly
 * does not normalize from `search.list`; that omission is recorded in the
 * search parity report rather than invented here.
 */
export function SearchResultRow({ video }: { video: VideoSummary }) {
  const duration = formatDuration(video.durationSeconds);
  const viewCount = formatViewCount(video.viewCount);
  const [firstCharacter] = Array.from(video.channelTitle.trim());

  return (
    <article
      data-slot="search-result"
      className="relative flex min-w-0 flex-col gap-3 sm:flex-row sm:gap-4"
    >
      <Link
        href={`/watch/${video.id}`}
        aria-label={video.title}
        className={cn(
          "group/thumb flex min-w-0 flex-1 flex-col gap-3 rounded-xl sm:flex-row sm:gap-4",
          FOCUS_RING,
        )}
      >
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:w-[360px] lg:w-[500px]">
          <Image
            src={video.thumbnailUrl}
            alt=""
            fill
            sizes={THUMBNAIL_SIZES}
            className="object-cover"
          />
          {duration === null ? null : (
            <span className="absolute right-1.5 bottom-1.5 rounded bg-background/85 px-1.5 py-0.5 text-xs font-medium text-foreground tabular-nums">
              <span className="sr-only">Duration </span>
              {duration}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 pr-10">
          <h3 className="line-clamp-2 text-lg leading-[26px] font-medium text-foreground">
            {video.title}
          </h3>

          {viewCount === null && video.publishedAt === "" ? null : (
            <p className="text-xs leading-5 text-muted-foreground">
              {viewCount === null ? null : <span>{viewCount}</span>}
              {viewCount === null ? null : <span aria-hidden="true"> · </span>}
              <RelativeAge publishedAt={video.publishedAt} />
            </p>
          )}

          {video.channelTitle === "" ? null : (
            <div className="mt-1 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
              >
                {firstCharacter?.toUpperCase() ?? "?"}
              </span>
              <span className="truncate text-sm text-muted-foreground">{video.channelTitle}</span>
            </div>
          )}
        </div>
      </Link>

      <div className="absolute top-0 right-0">
        <VideoCardMenu videoId={video.id} title={video.title} />
      </div>
    </article>
  );
}
