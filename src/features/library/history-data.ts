import "server-only";

/**
 * Server-only reads for the history tab (T35).
 *
 * The repository stays the single query layer: this module only maps a stored
 * row to the shapes the UI renders. `history.list()` is already ordered by
 * `lastViewedAt` descending, so the newest view is always first; the projection
 * preserves that order rather than re-sorting.
 *
 * Like the favourites and watch-later reads, this is reached from a Server
 * Component that sits behind the library page's `<Suspense>` boundary, so Cache
 * Components treats it as a request-time hole instead of prerendering it.
 */

import { getDb } from "@/lib/db/client";
import { createLibraryRepository, type HistoryRow } from "@/lib/db/repositories/library.repository";
import type { VideoSummary } from "@/shared/types";

import { displayThumbnailUrl } from "./video-snapshot";

/**
 * One history row as the tab needs it.
 *
 * The card reads the `VideoSummary`; `viewCount` is shown beside the clear
 * control, and `lastViewedAt` is kept for the ordering contract and for T37's
 * richer history UI.
 */
export interface HistoryEntry {
  /** Display projection, identical in shape to a saved video's summary. */
  video: VideoSummary;
  /** Most recent view, as stored. */
  lastViewedAt: Date;
  /** Number of recorded views; always at least 1 for a stored row. */
  viewCount: number;
}

/**
 * Maps a stored history row to the shape `VideoCard` renders.
 *
 * The history table stores the same display snapshot as favourites and watch
 * later, not a YouTube payload, so fields the card does not read are filled
 * deterministically: `channelId` and `publishedAt` have no stored value, and
 * `viewCount` is the *YouTube* count (unknown at view time), not the local
 * watch count.
 *
 * The thumbnail is projected through {@link displayThumbnailUrl} for the same
 * reason as the favourites and watch-later reads: a row written before the host
 * check (or by an older version) may point at a host `next/image` rejects, and
 * passing such a `src` straight to the card throws while rendering and takes the
 * whole history tab down. An off-host URL therefore renders YouTube's canonical
 * still for the id; the stored row is not rewritten, so the original value stays
 * in SQLite.
 */
export function historyRowToVideoSummary(row: HistoryRow): VideoSummary {
  return {
    id: row.videoId,
    title: row.title,
    channelId: "",
    channelTitle: row.channelTitle,
    thumbnailUrl: displayThumbnailUrl(row.videoId, row.thumbnailUrl),
    publishedAt: "",
    durationSeconds: row.durationSeconds,
    viewCount: null,
  };
}

/** Projects a row into the entry the history tab renders. */
export function historyRowToEntry(row: HistoryRow): HistoryEntry {
  return {
    video: historyRowToVideoSummary(row),
    lastViewedAt: row.lastViewedAt,
    viewCount: row.viewCount,
  };
}

/**
 * The owner whose history should be shown: the signed-in Google account id, or
 * `local` when signed out. Signed-out and signed-in activity never share rows.
 */
export async function currentHistoryOwner(): Promise<string> {
  try {
    const { getSessionAccount } = await import("@/lib/auth/google");
    const account = await getSessionAccount();

    return account?.id ?? "local";
  } catch {
    // Outside a request scope (tests, scripts) everything belongs to `local`.
    return "local";
  }
}

/** Every watched video for one owner, most recently viewed first. */
export function listHistoryEntries(owner?: string): HistoryEntry[] {
  const repository = createLibraryRepository(getDb());

  return repository.history.list(owner).map((row) => historyRowToEntry(row));
}
