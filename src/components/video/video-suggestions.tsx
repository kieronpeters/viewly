import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { formatDuration, formatViewCount } from "@/shared/format";
import type { VideoSummary } from "@/shared/types";

export interface VideoSuggestionsProps {
  /** Already filtered, de-duplicated and capped by `selectVideoSuggestions`. */
  videos: readonly VideoSummary[];
  className?: string;
}

/** Id of the section heading; a single instance exists on the watch page. */
const HEADING_ID = "watch-up-next-heading";

/** The rail thumbnail is 160px wide at every breakpoint. */
const THUMBNAIL_SIZES = "160px";

/**
 * Compact "Up next" rail beside the player (T32, restyled by T77).
 *
 * One row per suggestion: 16:9 thumbnail with the duration badge, then title,
 * channel and view count. The rows are deliberately much denser than the old
 * card grid so the 360px rail can show several candidates without scrolling
 * the page. Presentational only: the caller owns the fetch, the Suspense
 * boundary and the decision to hide the section, so no extra API call happens
 * here.
 *
 * The duration badge is visible but the link is named by the title alone;
 * otherwise the computed name would start with the duration.
 */
export function VideoSuggestions({ videos, className }: VideoSuggestionsProps) {
  return (
    <section
      aria-labelledby={HEADING_ID}
      data-slot="video-suggestions"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={HEADING_ID} className="text-base font-semibold tracking-tight text-foreground">
          Up next
        </h2>
        <p className="text-xs text-muted-foreground">
          Suggested by Viewly from a search for this channel.
        </p>
      </div>

      <ul role="list" className="flex flex-col gap-1">
        {videos.map((video) => {
          const duration = formatDuration(video.durationSeconds);
          const viewCount = formatViewCount(video.viewCount);

          return (
            <li key={video.id} className="min-w-0">
              <Link
                href={`/watch/${video.id}`}
                aria-label={video.title}
                data-slot="up-next-row"
                className="flex min-w-0 gap-2 rounded-lg p-1.5 transition-colors outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md bg-muted">
                  <Image
                    src={video.thumbnailUrl}
                    alt=""
                    fill
                    sizes={THUMBNAIL_SIZES}
                    className="object-cover"
                  />
                  {duration === null ? null : (
                    <span className="absolute right-1 bottom-1 rounded bg-background/85 px-1 py-0.5 text-[0.7rem] font-medium text-foreground tabular-nums">
                      <span className="sr-only">Duration </span>
                      {duration}
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
                  <h3 className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
                    {video.title}
                  </h3>
                  {video.channelTitle === "" ? null : (
                    <p className="truncate text-xs text-muted-foreground">{video.channelTitle}</p>
                  )}
                  {viewCount === null ? null : (
                    <p className="text-xs text-muted-foreground">{viewCount}</p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
