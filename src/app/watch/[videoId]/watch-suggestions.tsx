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
 * Data half of the watch page's "Up next" rail (T32, restyled by T77).
 *
 * Rendered inside its own `<Suspense>` boundary in the right-hand rail, so the
 * player, title, description and discussion never wait on this search. Any
 * failure — transport, quota, validation, an unexpected shape — is swallowed
 * here and renders nothing: suggestions are an enhancement, so a broken search
 * must not show an error banner over playback or leak an upstream URL. The same
 * applies to an empty result, which hides the whole section including its
 * heading.
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

/** Placeholder rows shown while the suggestions request is in flight. */
const PLACEHOLDER_COUNT = 4;

/**
 * Streaming fallback for the "Up next" rail.
 *
 * Deliberately quiet: a status line for assistive technology, then `aria-hidden`
 * placeholder geometry at the size the real rail will occupy. Nothing here
 * announces a heading, so a rail that ends up hidden (empty or failed) never
 * flashes a title that disappears.
 */
export function WatchSuggestionsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading up next…</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex flex-col gap-1">
          {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
            <div key={index} className="flex min-w-0 gap-2 p-1.5">
              <Skeleton className="aspect-video w-40 shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
