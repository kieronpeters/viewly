/**
 * Client-safe core of the favourites feature (T33).
 *
 * The snapshot shape, its projection and its validation are shared with watch
 * later and live in `video-snapshot.ts`; this module keeps the favourites names
 * the rest of the app imports and adds the repository-backed toggle.
 *
 * This module deliberately has **no runtime dependency** on the database layer:
 * `LibraryRepository` is imported as a type only, so a Client Component may
 * import the snapshot helpers below without pulling `better-sqlite3` (or the
 * `server-only` guard) into the browser bundle. The server-only entry points
 * live in `actions.ts` (mutation) and `library-data.ts` (reads).
 *
 * ## Idempotency
 *
 * {@link toggleFavouriteInRepository} reads the current state and then calls the
 * repository's idempotent `add` / `remove`. `better-sqlite3` is synchronous, so
 * the read and the write cannot interleave with another write on the same
 * connection, and repeating a toggle by hand (or a duplicated request) lands on
 * a well-defined state rather than a constraint error.
 */
import type { LibraryRepository } from "@/lib/db/repositories/library.repository";
import type { VideoSummary } from "@/shared/types";

import { parseVideoSnapshot, videoSnapshotFromVideo, type VideoSnapshot } from "./video-snapshot";

/** The display snapshot a favourite stores; shared with watch later. */
export type FavouriteSnapshot = VideoSnapshot;

/** What the action reports back; deliberately not a database row. */
export interface FavouriteToggleResult {
  /** The state that is now stored. */
  favourited: boolean;
}

/** Projects a normalized video into the snapshot the library stores. */
export function favouriteSnapshotFromVideo(video: VideoSummary): FavouriteSnapshot {
  return videoSnapshotFromVideo(video);
}

/** Validates and normalizes an untrusted snapshot. */
export function parseFavouriteSnapshot(input: unknown): FavouriteSnapshot {
  return parseVideoSnapshot(input);
}

/**
 * Adds or removes a favourite, returning the stored state.
 *
 * `savedAt` is passed in rather than read from the clock here, matching the
 * library repository's contract; the action supplies `new Date()`.
 */
export function toggleFavouriteInRepository(
  repository: LibraryRepository,
  snapshot: FavouriteSnapshot,
  savedAt: Date,
): FavouriteToggleResult {
  if (repository.favourites.isFavourite(snapshot.videoId)) {
    repository.favourites.remove(snapshot.videoId);

    return { favourited: false };
  }

  repository.favourites.add({ ...snapshot, savedAt });

  return { favourited: true };
}
