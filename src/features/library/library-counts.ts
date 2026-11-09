import "server-only";

/**
 * Per-tab totals for the library navigation (T37).
 *
 * The tab bar shows how much is in each section before the user opens it, so
 * the counts must not cost a list read: a list would materialise every row (and
 * the video tabs would then map them to `VideoSummary` just to discard the
 * result). Each total is a single `COUNT(*)` on a small, local SQLite table, so
 * four of them are cheaper than one list projection.
 *
 * No YouTube read happens here. Counts describe the on-device library only, and
 * this module is reached from the same request-time `<Suspense>` hole as the
 * list reads, never during prerendering.
 */

import { getDb } from "@/lib/db/client";
import { createLibraryRepository } from "@/lib/db/repositories/library.repository";

/** Number of rows behind each library tab, keyed by the tab's data source. */
export interface LibraryCounts {
  /** Saved favourites. */
  favourites: number;
  /** Videos queued in watch later. */
  watchLater: number;
  /** Distinct videos in the watch history. */
  history: number;
  /** Playlists, regardless of how many videos they hold. */
  playlists: number;
}

/**
 * Counts every library table in four `COUNT(*)` queries.
 *
 * Deliberately independent of the active tab: the tab bar always shows all four
 * totals, so resolving the active tab's list first would not save a query.
 */
export function countLibraryEntries(): LibraryCounts {
  const repository = createLibraryRepository(getDb());

  return {
    favourites: repository.favourites.count(),
    watchLater: repository.watchLater.count(),
    history: repository.history.count(),
    playlists: repository.playlists.count(),
  };
}
