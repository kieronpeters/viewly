import { VideoGrid } from "@/components/home/video-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import type { VideoSummary } from "@/shared/types";

import { getTrendingVideos } from "./home-data";
import { describeHomeError } from "./sections";

/**
 * The primary home feed: a responsive grid of trending videos, shaped like the
 * observed surface's first screen. It owns its own failure and empty states so
 * the rest of the page (chips, shelves) never waits on it.
 */
export async function FeedSection() {
  const titleId = "home-feed-heading";

  let videos: VideoSummary[];
  try {
    videos = await getTrendingVideos();
  } catch (error) {
    return (
      <section aria-labelledby={titleId} className="flex flex-col gap-4">
        <h2 id={titleId} className="sr-only">
          Videos
        </h2>
        <ErrorState title="Could not load videos" message={describeHomeError(error)} />
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <h2 id={titleId} className="sr-only">
        Videos
      </h2>
      {videos.length > 0 ? (
        <VideoGrid labelledBy={titleId} videos={videos} />
      ) : (
        <EmptyState
          title="Nothing to watch yet"
          message="Start watching or search for something to build this feed."
        />
      )}
    </section>
  );
}
