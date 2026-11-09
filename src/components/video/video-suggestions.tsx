import { VideoCard } from "@/components/video/video-card";
import { cn } from "@/lib/utils";
import type { VideoSummary } from "@/shared/types";

export interface VideoSuggestionsProps {
  /** Already filtered, de-duplicated and capped by `selectVideoSuggestions`. */
  videos: readonly VideoSummary[];
  className?: string;
}

/** Id of the section heading; a single instance exists on the watch page. */
const HEADING_ID = "watch-suggestions-heading";

/**
 * "More from this channel" cards under the player (T32).
 *
 * Presentational only: the caller owns the fetch, the Suspense boundary and the
 * decision to hide the section. The copy says the picks come from a Viewly
 * search, because the client has no channel filter and this is not YouTube's
 * related-videos list.
 */
export function VideoSuggestions({ videos, className }: VideoSuggestionsProps) {
  return (
    <section
      aria-labelledby={HEADING_ID}
      data-slot="video-suggestions"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-col gap-0.5">
        <h2
          id={HEADING_ID}
          className="text-lg font-semibold tracking-tight text-foreground sm:text-xl"
        >
          More from this channel
        </h2>
        <p className="text-xs text-muted-foreground">
          Suggested by Viewly from a search for this channel.
        </p>
      </div>

      <ul role="list" className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 2xl:grid-cols-3">
        {videos.map((video) => (
          <li key={video.id} className="min-w-0">
            <VideoCard video={video} className="h-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}
