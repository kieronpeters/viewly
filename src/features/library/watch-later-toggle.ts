/**
 * Client-safe core of the Watch Later feature (T34).
 *
 * Mirrors `favourite-toggle.ts`: the snapshot shape, projection and validation
 * are shared through `video-snapshot.ts`, and this module adds the
 * repository-backed toggle. It has **no runtime dependency** on the database
 * layer (`LibraryRepository` is a type-only import), so a Client Component may
 * import it without pulling SQLite into the browser bundle.
 *
 * ## Idempotency
 *
 * {@link toggleWatchLaterInRepository} reads the current state and then calls
 * the repository's idempotent `add` / `remove`. `better-sqlite3` is synchronous,
 * so the read and the write cannot interleave with another write on the same
 * connection, and repeating a toggle (or a duplicated request) lands on a
 * well-defined state rather than a constraint error.
 */
import type { LibraryRepository } from "@/lib/db/repositories/library.repository";
import type { VideoSummary } from "@/shared/types";

import { parseVideoSnapshot, videoSnapshotFromVideo, type VideoSnapshot } from "./video-snapshot";

/** The display snapshot a watch-later entry stores; shared with favourites. */
export type WatchLaterSnapshot = VideoSnapshot;

/** What the action reports back; deliberately not a database row. */
export interface WatchLaterToggleResult {
  /** The state that is now stored. */
  inWatchLater: boolean;
}

/** Projects a normalized video into the snapshot the library stores. */
export function watchLaterSnapshotFromVideo(video: VideoSummary): WatchLaterSnapshot {
  return videoSnapshotFromVideo(video);
}

/** Validates and normalizes an untrusted snapshot. */
export function parseWatchLaterSnapshot(input: unknown): WatchLaterSnapshot {
  return parseVideoSnapshot(input);
}

/**
 * Adds or removes a watch-later entry, returning the stored state.
 *
 * `savedAt` is passed in rather than read from the clock here, matching the
 * library repository's contract; the action supplies `new Date()`.
 */
export function toggleWatchLaterInRepository(
  repository: LibraryRepository,
  snapshot: WatchLaterSnapshot,
  savedAt: Date,
): WatchLaterToggleResult {
  if (repository.watchLater.isInWatchLater(snapshot.videoId)) {
    repository.watchLater.remove(snapshot.videoId);

    return { inWatchLater: false };
  }

  repository.watchLater.add({ ...snapshot, savedAt });

  return { inWatchLater: true };
}
