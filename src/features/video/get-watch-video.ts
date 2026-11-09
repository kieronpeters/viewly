import "server-only";

import { cache } from "react";

import { getVideo } from "@/lib/youtube/client";
import type { VideoDetail } from "@/shared/types";

/**
 * Reads one video for the watch page.
 *
 * Wrapped in React's `cache` so `generateMetadata` and the page body share one
 * YouTube request per render instead of spending quota twice. The id must be
 * validated by the caller first (`assertVideoId` in the route helper); `getVideo`
 * validates again and throws on a malformed value.
 *
 * Deliberately uncached across requests: the page renders this behind a
 * `<Suspense>` boundary, so Cache Components can serve the static shell while
 * the request runs.
 */
export const getWatchVideo = cache(async (videoId: string): Promise<VideoDetail | null> => {
  return getVideo(videoId);
});
