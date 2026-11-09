"use server";

/**
 * Server Actions for viewing history (T35).
 *
 * `recordView` is the write behind the watch player: the first time playback
 * starts, the client sends the display snapshot the server just rendered. The
 * action validates it, calls the repository's upsert with `new Date()`, and
 * revalidates `/library` so the history tab reflects the new entry.
 *
 * `clearHistoryEntry` and `clearAllHistory` are the two destructive controls on
 * the history tab. Both are idempotent: clearing a row that is already gone, or
 * clearing an empty table, is a no-op.
 *
 * ## Why the database modules are imported inside each action
 *
 * A Server Action module is imported by Client Components for its action
 * reference. A top-level `import "@/lib/db/client"` would execute the
 * `server-only` guard and load the native SQLite driver whenever the module is
 * evaluated outside Next's server graph (for example in Vitest, where the
 * player and the history controls render in jsdom). Loading the connection
 * lazily keeps the actions inert at import time.
 *
 * ## Return values
 *
 * `recordView` returns nothing: the caller only needs to know that the write
 * was accepted, and a database row would leak storage details to the client.
 * The clear actions also return nothing; the revalidated history list is the
 * only state the UI reads. Validation failures throw before any write, which is
 * the same contract as the other library actions.
 */
import { revalidatePath } from "next/cache";

import { assertVideoId } from "@/shared/validation";

import type { VideoSnapshot } from "./video-snapshot";
import { parseVideoSnapshot } from "./video-snapshot";

/** Route that lists saved videos, including the history tab. */
const LIBRARY_PATH = "/library";

/**
 * Resolves the repository for one action.
 *
 * Kept as a local helper rather than an exported function: a `"use server"`
 * module may only export async functions.
 */
async function libraryRepository() {
  const [{ getDb }, { createLibraryRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/library.repository"),
  ]);

  return createLibraryRepository(getDb());
}

/**
 * Records one view of a video.
 *
 * The repository upserts on the video id, so this is one row per video:
 * `viewCount` increments and `lastViewedAt` moves to now. The caller never
 * supplies a timestamp, a user or a board identity; there is exactly one local
 * library.
 */
export async function recordView(input: VideoSnapshot): Promise<void> {
  const snapshot = parseVideoSnapshot(input);
  const repository = await libraryRepository();

  repository.history.recordView({ ...snapshot, viewedAt: new Date() });

  revalidatePath(LIBRARY_PATH);
}

/** Removes one video from the history list. A repeat clear is a no-op. */
export async function clearHistoryEntry(videoId: string): Promise<void> {
  const id = assertVideoId(videoId);
  const repository = await libraryRepository();

  repository.history.clearOne(id);

  revalidatePath(LIBRARY_PATH);
}

/** Empties the history list. A repeat clear is a no-op. */
export async function clearAllHistory(): Promise<void> {
  const repository = await libraryRepository();

  repository.history.clearAll();

  revalidatePath(LIBRARY_PATH);
}
