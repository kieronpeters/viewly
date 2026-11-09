import { Fragment } from "react";

import { cn } from "@/lib/utils";
import { formatDuration, formatViewCount } from "@/shared/format";
import type { VideoDetail } from "@/shared/types";

import { ExpandableDescription } from "./expandable-description";
import { formatPublishedDate } from "./format-published-date";

/** One present row of the definition list. Absent fields are never built. */
interface MetadataRow {
  readonly label: string;
  readonly value: string;
  /** Set for the published row so `<time>` can carry the machine-readable ISO value. */
  readonly dateTime?: string;
}

export interface VideoMetadataProps {
  /** Already normalized by the YouTube client; never built from a raw payload. */
  video: VideoDetail;
  /** Optional layout classes; the page owns the aside wrapper. */
  className?: string;
}

/**
 * Details panel for `/watch/[videoId]`: compact metadata plus the description.
 *
 * Server-rendered except for the description's expand/collapse button. Null or
 * empty fields (view count, duration, channel, unparseable date, description)
 * are omitted rather than rendered as blank rows, so the list only ever shows
 * information the source actually provided.
 */
export function VideoMetadata({ video, className }: VideoMetadataProps) {
  const rows = buildMetadataRows(video);
  const hasDescription = video.description.trim() !== "";

  return (
    <div data-slot="video-metadata" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <h2 id="watch-details-heading" className="text-sm font-semibold text-foreground">
        Video details
      </h2>

      {rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-foreground">
                {row.dateTime === undefined ? (
                  row.value
                ) : (
                  <time dateTime={row.dateTime}>{row.value}</time>
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : null}

      {hasDescription ? (
        <section
          aria-labelledby="watch-description-heading"
          className="flex min-w-0 flex-col gap-1.5"
        >
          <h3 id="watch-description-heading" className="text-sm font-semibold text-foreground">
            Description
          </h3>
          <ExpandableDescription text={video.description} />
        </section>
      ) : null}
    </div>
  );
}

/**
 * Builds only the rows that have renderable values. Order is deliberate:
 * identity first, then the numbers a viewer scans for.
 */
function buildMetadataRows(video: VideoDetail): MetadataRow[] {
  const rows: MetadataRow[] = [];

  if (video.channelTitle.trim() !== "") {
    rows.push({ label: "Channel", value: video.channelTitle });
  }

  const publishedAt = formatPublishedDate(video.publishedAt);
  if (publishedAt !== null) {
    rows.push({ label: "Published", value: publishedAt, dateTime: video.publishedAt });
  }

  const viewCount = formatViewCount(video.viewCount);
  if (viewCount !== null) {
    // `formatViewCount` always appends " views"; the `dt` already labels the
    // number, so drop the suffix to avoid "Views 1.5B views".
    rows.push({ label: "Views", value: viewCount.replace(/ views?$/, "") });
  }

  const duration = formatDuration(video.durationSeconds);
  if (duration !== null) {
    rows.push({ label: "Duration", value: duration });
  }

  return rows;
}
