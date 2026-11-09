import { Skeleton } from "@/components/ui";
import { VideoSuggestions } from "@/components/video/video-suggestions";
import { getVideoSuggestions } from "@/features/video";
import type { VideoSummary } from "@/shared/types";

export interface WatchSuggestionsProps {
  /** Channel name of the current video; the suggestions query. */
  channelTitle: string;
  /** Current video id; always excluded from its own suggestions. */
  currentVideoId: string;
}

/**
 * Data half of the watch page's suggestions section (T32).
 *
 * Rendered inside its own `<Suspense>` boundary below the player, so the player
 * and metadata are never held back by this search. Any failure — transport,
 * quota, validation, an unexpected shape — is swallowed here and renders
 * nothing: suggestions are an enhancement, so a broken search must not show an
 * error banner over playback or leak an upstream URL. The same applies to an
 * empty result, which hides the whole section including its heading.
 */
export async function WatchSuggestions({ channelTitle, currentVideoId }: WatchSuggestionsProps) {
  let videos: VideoSummary[];

  try {
    videos = await getVideoSuggestions({ channelTitle, currentVideoId });
  } catch {
    return null;
  }

  if (videos.length === 0) {
    return null;
  }

  return <VideoSuggestions videos={videos} />;
}

/** Placeholder cards shown while the suggestions request is in flight. */
const PLACEHOLDER_COUNT = 2;

/**
 * Streaming fallback for the suggestions section.
 *
 * Deliberately quiet: a status line for assistive technology, then `aria-hidden`
 * placeholder geometry at the size the real section will occupy. Nothing here
 * announces a heading, so a section that ends up hidden (empty or failed) never
 * flashes a title that disappears.
 */
export function WatchSuggestionsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading suggestions…</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-2">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
