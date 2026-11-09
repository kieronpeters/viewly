import "server-only";

/**
 * Server-only reads for the personal library (T33/T34).
 *
 * These functions are the read half of the saved-video features: the library
 * page lists favourites or watch-later entries newest first and the watch page
 * asks whether the current video is already saved. All of them are reached only
 * from Server Components that sit inside a `<Suspense>` boundary which also
 * awaits a runtime API (`params` or `searchParams`), so Cache Components treats
 * the read as a request-time hole rather than prerendering it into the static
 * shell.
 *
 * The repository stays the single query layer: nothing here builds SQL by hand.
 */

import { getDb } from "@/lib/db/client";
import {
  createLibraryRepository,
  type FavouriteRow,
  type WatchLaterRow,
} from "@/lib/db/repositories/library.repository";
import type { VideoSummary } from "@/shared/types";

/**
 * Maps a stored favourite to the shape `VideoCard` renders.
 *
 * The library stores a deliberate display snapshot, not a YouTube payload, so
 * fields the card does not read are filled deterministically: `channelId` and
 * `publishedAt` have no stored value, and `viewCount` is unknown at save time.
 * The card reads only id, title, channel, thumbnail and duration, so no UI is
 * affected by those placeholders.
 */
export function favouriteToVideoSummary(row: FavouriteRow): VideoSummary {
  return {
    id: row.videoId,
    title: row.title,
    channelId: "",
    channelTitle: row.channelTitle,
    thumbnailUrl: row.thumbnailUrl,
    publishedAt: "",
    durationSeconds: row.durationSeconds,
    viewCount: null,
  };
}

/** Maps a favourites list, preserving the repository's newest-first order. */
export function favouritesToVideoSummaries(rows: readonly FavouriteRow[]): VideoSummary[] {
  return rows.map((row) => favouriteToVideoSummary(row));
}

/**
 * Maps a watch-later row to the shape `VideoCard` renders.
 *
 * The stored columns are identical to a favourite's, so the same projection
 * applies; keeping a named wrapper documents which list produced the summary
 * and leaves room for watch-later-specific fields later.
 */
export function watchLaterToVideoSummary(row: WatchLaterRow): VideoSummary {
  return favouriteToVideoSummary(row);
}

/** Maps a watch-later list, preserving the repository's newest-first order. */
export function watchLaterToVideoSummaries(rows: readonly WatchLaterRow[]): VideoSummary[] {
  return rows.map((row) => watchLaterToVideoSummary(row));
}

/** Every saved video, most recently saved first. */
export function listFavouriteVideos(): VideoSummary[] {
  const repository = createLibraryRepository(getDb());

  return favouritesToVideoSummaries(repository.favourites.list());
}

/** Every queued video, most recently added first. */
export function listWatchLaterVideos(): VideoSummary[] {
  const repository = createLibraryRepository(getDb());

  return watchLaterToVideoSummaries(repository.watchLater.list());
}

/** Whether the video is currently a favourite; drives the control's initial state. */
export function isVideoFavourite(videoId: string): boolean {
  const repository = createLibraryRepository(getDb());

  return repository.favourites.isFavourite(videoId);
}

/** Whether the video is queued in watch later; drives the control's initial state. */
export function isInWatchLater(videoId: string): boolean {
  const repository = createLibraryRepository(getDb());

  return repository.watchLater.isInWatchLater(videoId);
}
