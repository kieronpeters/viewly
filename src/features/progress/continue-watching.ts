import "server-only";

/**
 * Server-only read for the "Continue watching" shelves (T72).
 *
 * The shelf is built entirely from local data: the repository joins
 * `video_progress` to the stored display snapshots, so rendering it never calls
 * YouTube. A video that was watched but never favourited, queued or recorded in
 * history has no snapshot to display and is therefore absent from the shelf.
 *
 * `connection()` opts the (synchronous) `better-sqlite3` read into request-time
 * rendering. The library page already awaits `searchParams`, but the home page
 * has no other request-time API, so without it the shelf would be captured
 * during prerendering and never reflect newly watched videos.
 */
import { connection } from "next/server";

import { displayThumbnailUrl } from "@/features/library/video-snapshot";
import { getDb } from "@/lib/db/client";
import {
  createProgressRepository,
  type ContinueWatchingRow,
} from "@/lib/db/repositories/progress.repository";
import type { VideoSummary } from "@/shared/types";

import type { PlaybackPosition } from "./progress";

/** One card on the shelf: a display snapshot plus the stored position. */
export interface ContinueWatchingItem {
  /** The stored snapshot, already projected for `VideoCard`. */
  video: VideoSummary;
  /** Position and duration for the card's progress bar. */
  progress: PlaybackPosition;
}

/**
 * Maps a joined repository row to the card shapes.
 *
 * The stored snapshot has no `channelId`, `publishedAt` or `viewCount`; the
 * card does not read them, so they get deterministic empty values. The
 * thumbnail is projected through {@link displayThumbnailUrl} for the same
 * reason as the library: a row saved before the host check must not throw while
 * rendering the whole shelf.
 */
export function continueWatchingFromRow(row: ContinueWatchingRow): ContinueWatchingItem {
  return {
    video: {
      id: row.videoId,
      title: row.title,
      channelId: "",
      channelTitle: row.channelTitle,
      thumbnailUrl: displayThumbnailUrl(row.videoId, row.thumbnailUrl),
      publishedAt: "",
      durationSeconds: row.durationSeconds,
      viewCount: null,
    },
    progress: {
      positionSeconds: row.positionSeconds,
      durationSeconds: row.progressDurationSeconds,
    },
  };
}

/**
 * Every in-progress video with a stored snapshot, most recently watched first.
 *
 * "In progress" is the same window as the resume prompt and the card bar: 5%
 * inclusive up to, but excluding, 95%. The repository applies the filter in
 * SQL, so this function never sees a barely-started or effectively-finished
 * video.
 */
export async function listContinueWatchingVideos(): Promise<ContinueWatchingItem[]> {
  await connection();

  const rows = createProgressRepository(getDb()).listContinueWatching();

  return rows.map(continueWatchingFromRow);
}
