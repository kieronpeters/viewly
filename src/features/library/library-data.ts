import "server-only";

/**
 * Server-only reads for the personal library (T33).
 *
 * These functions are the read half of the favourites feature: the library page
 * lists saved videos newest first and the watch page asks whether the current
 * video is already saved. Both are reached only from Server Components that sit
 * inside a `<Suspense>` boundary which also awaits a runtime API (`params` or
 * `searchParams`), so Cache Components treats the read as a request-time hole
 * rather than prerendering it into the static shell.
 *
 * The repository stays the single query layer: nothing here builds SQL by hand.
 */

import { getDb } from "@/lib/db/client";
import {
  createLibraryRepository,
  type FavouriteRow,
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

/** Every saved video, most recently saved first. */
export function listFavouriteVideos(): VideoSummary[] {
  const repository = createLibraryRepository(getDb());

  return favouritesToVideoSummaries(repository.favourites.list());
}

/** Whether the video is currently a favourite; drives the control's initial state. */
export function isVideoFavourite(videoId: string): boolean {
  const repository = createLibraryRepository(getDb());

  return repository.favourites.isFavourite(videoId);
}
