"use server";

/**
 * Server Actions for local playback progress (T68).
 *
 * ## Contract
 *
 * `saveProgress(videoId, position, duration)` is called by the watch player
 * while it plays, at most once every five seconds. It validates the three
 * arguments, then:
 *
 * - ignores a position under one second, so a video that never actually played
 *   never gets a row;
 * - clears the row when the position has reached 95% of the duration, so a
 *   finished video is not offered for resume;
 * - otherwise upserts the position and duration for that video.
 *
 * `clearProgress(videoId)` backs the resume prompt's "Start over" button. It is
 * idempotent: clearing a video that has no row is a no-op.
 *
 * Both actions revalidate `/library`, whose cards render the progress bar. The
 * watch page is request-time, so it reads the row again on the next navigation;
 * no extra revalidation is needed there.
 *
 * ## Validation
 *
 * As with the other actions, input is untrusted: a Server Action is reachable
 * by direct POST. `parsePlaybackProgress` rejects a malformed video id, a
 * negative or non-finite position and a non-positive duration before any query
 * runs.
 *
 * ## Why the database modules are imported inside each action
 *
 * A Server Action module is imported by Client Components for its action
 * reference. A top-level `import "@/lib/db/client"` would execute the
 * `server-only` guard and load the native SQLite driver whenever the module is
 * evaluated outside Next's server graph (for example in Vitest, where the
 * player renders in jsdom). Loading the connection lazily keeps the actions
 * inert at import time.
 */
import { revalidatePath } from "next/cache";

import { assertVideoId } from "@/shared/validation";

import { isProgressComplete, parsePlaybackProgress } from "./progress";

/** Route whose cards show the progress bar. */
const LIBRARY_PATH = "/library";

/** Resolves the repository for one action, lazily and without import-time I/O. */
async function progressRepository() {
  const [{ getDb }, { createProgressRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/progress.repository"),
  ]);

  return createProgressRepository(getDb());
}

/**
 * Records one playback position.
 *
 * Returns nothing: the player does not need the stored row, and a failed write
 * must never interrupt playback (the caller swallows rejections).
 */
export async function saveProgress(
  videoId: string,
  position: number,
  duration: number,
): Promise<void> {
  const parsed = parsePlaybackProgress(videoId, position, duration);

  // A video that never played has nothing worth resuming. This is also what
  // keeps a page load (autoplay is off) from writing a row.
  if (parsed.positionSeconds < 1) {
    return;
  }

  const repository = await progressRepository();

  if (isProgressComplete(parsed.positionSeconds, parsed.durationSeconds)) {
    repository.clear(parsed.videoId);
  } else {
    repository.save({ ...parsed, updatedAt: new Date() });
  }

  revalidatePath(LIBRARY_PATH);
}

/** Deletes one video's progress so the next visit starts from the beginning. */
export async function clearProgress(videoId: string): Promise<void> {
  const id = assertVideoId(videoId);

  const repository = await progressRepository();

  if (repository.clear(id)) {
    revalidatePath(LIBRARY_PATH);
  }
}
