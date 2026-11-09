import { VideoRow } from "@/components/home/video-row";
import { VideoRowSection } from "@/components/home/video-row-section";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { isYouTubeApiError } from "@/lib/youtube/client";
import type { VideoSummary } from "@/shared/types";

import { getCategoryRowVideos, getTrendingVideos } from "./home-data";

/**
 * The trending row.
 *
 * Async on purpose: it is rendered inside its own `<Suspense>` boundary, so the
 * page shell (hero, headings) prerenders while this request is in flight. A
 * failure is caught here and rendered as an authored error state, so it can
 * never blank the rest of the page.
 */
export async function TrendingSection() {
  const titleId = "home-trending-heading";

  let videos: VideoSummary[];
  try {
    videos = await getTrendingVideos();
  } catch (error) {
    return (
      <VideoRowSection title="Trending" titleId={titleId}>
        <ErrorState title="Trending unavailable" message={describeHomeError(error)} />
      </VideoRowSection>
    );
  }

  return (
    <VideoRowSection title="Trending" titleId={titleId}>
      {videos.length > 0 ? (
        <VideoRow labelledBy={titleId} videos={videos} />
      ) : (
        <EmptyState
          title="No trending videos right now"
          message="Check back soon, or search for something to watch."
        />
      )}
    </VideoRowSection>
  );
}

export interface CategorySectionProps {
  /** Category slug from the shared category list, e.g. `"music"`. */
  slug: string;
  /** Row title, e.g. `"Music"`. */
  name: string;
}

/**
 * One category row.
 *
 * Each row has its own `<Suspense>` boundary on the page and its own failure
 * handling, so one broken category search degrades to a single error state
 * instead of hiding the other rows.
 */
export async function CategorySection({ slug, name }: CategorySectionProps) {
  const titleId = `home-category-${slug}-heading`;
  const viewAllHref = `/category/${slug}`;

  let videos: VideoSummary[];
  try {
    videos = await getCategoryRowVideos(slug);
  } catch (error) {
    return (
      <VideoRowSection title={name} titleId={titleId} viewAllHref={viewAllHref}>
        <ErrorState title={`${name} unavailable`} message={describeHomeError(error)} />
      </VideoRowSection>
    );
  }

  return (
    <VideoRowSection title={name} titleId={titleId} viewAllHref={viewAllHref}>
      {videos.length > 0 ? (
        <VideoRow labelledBy={titleId} videos={videos} />
      ) : (
        <EmptyState
          title={`No ${name} videos right now`}
          message="Try a search for something to watch while this section fills up."
        />
      )}
    </VideoRowSection>
  );
}

/**
 * Maps a client failure to user-facing copy.
 *
 * Only the stable `code` decides the message: HTTP status, upstream reasons and
 * the request URL (which can contain the API key) are never rendered.
 */
function describeHomeError(error: unknown): string {
  if (!isYouTubeApiError(error)) {
    return "Something went wrong while loading this section. Please try again in a moment.";
  }

  switch (error.code) {
    case "quota":
      return "The YouTube API quota has been reached. Please try again later.";
    case "auth":
      return "YouTube is not configured correctly right now. Please try again later.";
    case "timeout":
      return "The request took too long. Check your connection and try again.";
    case "network":
      return "Could not reach YouTube. Check your connection and try again.";
    case "bad_request":
    case "not_found":
    case "upstream":
      return "YouTube could not answer this request. Please try again in a moment.";
  }
}
