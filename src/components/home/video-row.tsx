import { VideoCard } from "@/components/video/video-card";
import { cn } from "@/lib/utils";
import type { VideoSummary } from "@/shared/types";

export interface VideoRowProps {
  /** Id of the heading that names this row. */
  labelledBy: string;
  videos: readonly VideoSummary[];
  className?: string;
}

/**
 * A horizontal, snapping row on small screens and a grid from `sm` up.
 *
 * On mobile the row bleeds to the container edges (`-mx-4`/`px-4`) so a partial
 * card hints that the row scrolls; each card is a fixed width and a snap point.
 * From `sm` the cards join the same 2/3/4-column grid used elsewhere.
 */
export function VideoRow({ labelledBy, videos, className }: VideoRowProps) {
  return (
    <ul
      aria-labelledby={labelledBy}
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {videos.map((video) => (
        <li key={video.id} className="w-60 shrink-0 snap-start sm:w-auto sm:min-w-0">
          <VideoCard video={video} className="h-full" />
        </li>
      ))}
    </ul>
  );
}
