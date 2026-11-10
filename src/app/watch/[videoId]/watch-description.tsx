import { ExpandableDescription } from "@/components/video/expandable-description";
import { formatPublishedDate } from "@/components/video/format-published-date";
import { formatDuration, formatViewCount } from "@/shared/format";
import type { VideoDetail } from "@/shared/types";

import { WatchChapters } from "./watch-chapters";

export interface WatchDescriptionProps {
  /** Already normalized by the YouTube client; never built from a raw payload. */
  video: VideoDetail;
}

/**
 * Description block under the watch title (T77).
 *
 * The old sidebar details panel is now part of the primary column: a compact
 * stats line (views, duration, publish date) followed by the same safe,
 * expandable description. Null or unparseable fields are omitted rather than
 * printed as blanks, matching the rest of the watch page.
 *
 * `ExpandableDescription` renders the text through React text nodes and only
 * linkifies absolute http(s) URLs, so no upstream HTML reaches the page.
 *
 * T71 adds two ways to scrub to a timestamp in that same text: every `0:00` /
 * `12:34` / `1:02:03` becomes a button, and a Chapters list appears once there
 * are at least two distinct timestamps. Both seek the player through the shared
 * channel; neither is a link, so a click cannot navigate.
 */
export function WatchDescription({ video }: WatchDescriptionProps) {
  const viewCount = formatViewCount(video.viewCount);
  const duration = formatDuration(video.durationSeconds);
  const publishedAt = formatPublishedDate(video.publishedAt);
  const hasDescription = video.description.trim() !== "";
  const hasStats = viewCount !== null || duration !== null || publishedAt !== null;

  return (
    <section
      aria-labelledby="watch-description-heading"
      data-slot="watch-description"
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4"
    >
      <h2 id="watch-description-heading" className="text-sm font-semibold text-foreground">
        Description
      </h2>

      {hasStats ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
          {viewCount === null ? null : <span>{viewCount}</span>}
          {viewCount !== null && (duration !== null || publishedAt !== null) ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {duration === null ? null : (
            <span>
              <span className="sr-only">Duration </span>
              {duration}
            </span>
          )}
          {duration !== null && publishedAt !== null ? <span aria-hidden="true">·</span> : null}
          {publishedAt === null ? null : (
            <time dateTime={video.publishedAt}>Published {publishedAt}</time>
          )}
        </p>
      ) : null}

      {hasDescription ? (
        <ExpandableDescription
          text={video.description}
          // The watch column is far wider than the old sidebar; a larger line
          // budget keeps the collapse decision honest without DOM measurement.
          charactersPerLine={90}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No description was provided for this video.</p>
      )}

      {hasDescription ? <WatchChapters text={video.description} /> : null}
    </section>
  );
}
