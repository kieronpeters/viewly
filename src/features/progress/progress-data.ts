import "server-only";

/**
 * Server-only reads for local playback progress (T68).
 *
 * The watch page reads one video's position to decide whether to show its
 * resume prompt; the library page reads a batch for the cards it renders. Both
 * run inside the page's existing `<Suspense>` boundary, next to the other
 * request-time SQLite reads, so Cache Components treats them as a runtime hole
 * rather than prerendering them.
 *
 * The repository stays the single query layer: nothing here builds SQL by hand.
 */
import { getDb } from "@/lib/db/client";
import { readDatabase, type DatabaseRead } from "@/lib/db/read-state";
import { createProgressRepository } from "@/lib/db/repositories/progress.repository";
import { isVideoId } from "@/shared/validation";

import { progressFromRow, type VideoProgress } from "./progress";

/** One video's stored progress, or `null` when there is none. */
export function getVideoProgress(videoId: string): VideoProgress | null {
  if (!isVideoId(videoId)) {
    return null;
  }

  const row = createProgressRepository(getDb()).get(videoId);

  return row === undefined ? null : progressFromRow(row);
}

/**
 * Guarded form of {@link getVideoProgress} for the watch page.
 *
 * A database that predates the progress migration reports `no such table:
 * video_progress`; the page renders an authored setup state for that instead of
 * letting a raw SQLite error become a 500.
 */
export function readVideoProgress(videoId: string): DatabaseRead<VideoProgress | null> {
  return readDatabase(() => getVideoProgress(videoId));
}

/**
 * Stored progress for a list of videos, keyed by video id.
 *
 * Ids that are not valid YouTube ids are skipped rather than throwing: the
 * list comes from stored display snapshots, and one malformed row must not
 * take the whole library tab down. Videos without progress are simply absent
 * from the map, so callers fall back to a card without a bar.
 */
export function listVideoProgress(videoIds: readonly string[]): Map<string, VideoProgress> {
  const ids = [...new Set(videoIds.filter(isVideoId))];

  const progress = new Map<string, VideoProgress>();

  for (const row of createProgressRepository(getDb()).listForVideos(ids)) {
    progress.set(row.videoId, progressFromRow(row));
  }

  return progress;
}
