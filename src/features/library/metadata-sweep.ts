import "server-only";

/**
 * Lazy 30-day metadata sweep for saved videos (T46, option A).
 *
 * ## Why
 *
 * The library stores a display snapshot (title, channel, thumbnail, duration)
 * on every saved row so a card renders without a YouTube call. That snapshot
 * would otherwise never change. YouTube's API terms also limit how long
 * Non-Authorized API Data may be stored without a refresh, so the snapshot has
 * a 30-day lifetime: the first library request after that window refreshes
 * every distinct saved video, then records the completion time.
 *
 * ## Lazy, not scheduled
 *
 * Viewly is a single-user local app with no background worker. The sweep runs
 * on the library request path, inside the page's existing `<Suspense>`
 * boundary, and only when `last_sweep_at` is absent or older than
 * {@link SWEEP_INTERVAL_MS}. Every other request pays one indexed settings
 * read and nothing else. If the app is not opened for months, the next visit
 * is the sweep; rows can therefore be older than 30 days while the app is
 * closed, which the documentation must state rather than claim otherwise.
 *
 * The default clock is request-time: `connection()` is awaited before
 * `new Date()` so Cache Components never sees a clock read while prerendering.
 * A caller that supplies its own `now` has already crossed that boundary.
 *
 * ## Failure behaviour
 *
 * A YouTube quota, transport or upstream failure must never break the library
 * page. All batches are fetched **before any row is written**, so a failure in
 * the middle of a multi-batch sweep leaves every stored snapshot untouched.
 * `last_sweep_at` is written only after the whole sweep has been applied, so a
 * failed or partial sweep is retried on the next request. The function catches
 * every error and reports `status: "failed"` instead of throwing.
 *
 * ## What is never done
 *
 * No saved id is deleted, and no schema column changes: a video YouTube no
 * longer returns keeps its row and is relabelled with an authored
 * "Unavailable video" snapshot. Playlist items store ids only and are not
 * swept.
 */

import { connection } from "next/server";

import { getDb } from "@/lib/db/client";
import {
  createLibraryRepository,
  type LibraryRepository,
  type SnapshotRefreshInput,
} from "@/lib/db/repositories/library.repository";
import { getVideos } from "@/lib/youtube/client";
import type { VideoSummary } from "@/shared/types";

/** Settings key that holds the ISO-8601 time of the last completed sweep. */
export const LAST_SWEEP_AT_SETTING_KEY = "last_sweep_at";

/** Minimum age before a new sweep runs: 30 calendar days in milliseconds. */
export const SWEEP_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Ids per `videos.list` request. The client also chunks at 50, but batching
 * here makes one logical request per batch explicit (and keeps the sweep's
 * request count visible to tests).
 */
export const SWEEP_BATCH_SIZE = 50;

/** Authored title for a saved video YouTube no longer returns. */
export const UNAVAILABLE_VIDEO_TITLE = "Unavailable video";

/** Stable public thumbnail endpoint, used when YouTube has no metadata. */
export function fallbackThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Outcome of one sweep attempt. */
export type SweepStatus = "completed" | "skipped" | "failed";

export interface SweepResult {
  /** `skipped`: still fresh; `failed`: nothing was written; `completed`: done. */
  status: SweepStatus;
  /** Distinct saved videos considered (0 when skipped or before a failure). */
  videoCount: number;
  /** Videos whose snapshot was refreshed from YouTube. */
  refreshedCount: number;
  /** Videos relabelled with the unavailable placeholder. */
  unavailableCount: number;
}

/**
 * Injectable dependencies, used by tests and by any caller that already holds
 * a repository. Production passes nothing and uses the process database plus
 * the real YouTube client.
 */
export interface SweepDependencies {
  /** Repository over an existing client; defaults to `getDb()`. */
  repository?: LibraryRepository;
  /** Batch fetch, defaulting to the real `getVideos`. */
  fetchVideos?: (ids: readonly string[]) => Promise<VideoSummary[]>;
  /**
   * Clock, letting tests fix the 30-day boundary.
   *
   * When omitted, the sweep awaits the request boundary before reading
   * `new Date()`. Supplying it means the caller already crossed that boundary.
   */
  now?: () => Date;
}

/**
 * Runs the sweep if it is due, and never throws.
 *
 * The whole body is guarded, including the settings read: a missing or locked
 * database is reported as `failed` so the library page can still render its
 * current (possibly stale) snapshots.
 */
export async function sweepLibraryMetadata(
  dependencies: SweepDependencies = {},
): Promise<SweepResult> {
  // Keep the dynamic bailout outside the catch-all below: if this runs during a
  // prerender, `connection()` must reach Next so the segment becomes
  // request-time, not turn into a silently "failed" sweep. Existing callers
  // that pass `now` skip it because they already crossed the boundary.
  if (dependencies.now === undefined) {
    await connection();
  }

  let videoCount = 0;

  try {
    const now = dependencies.now?.() ?? new Date();
    const repository = dependencies.repository ?? createLibraryRepository(getDb());
    const lastSweepAt = repository.settings.get(LAST_SWEEP_AT_SETTING_KEY);

    if (!isSweepDue(lastSweepAt, now)) {
      return { status: "skipped", videoCount: 0, refreshedCount: 0, unavailableCount: 0 };
    }

    const videoIds = repository.snapshots.listVideoIds();
    videoCount = videoIds.length;

    if (videoIds.length === 0) {
      // An empty library is a completed sweep: there is nothing to refresh, and
      // recording it stops every subsequent visit being treated as due.
      repository.settings.set(LAST_SWEEP_AT_SETTING_KEY, now.toISOString(), now);

      return { status: "completed", videoCount: 0, refreshedCount: 0, unavailableCount: 0 };
    }

    const fetchVideos = dependencies.fetchVideos ?? getVideos;

    // Phase 1: fetch every batch. Nothing is written until all batches have
    // succeeded, so an upstream failure leaves every stored snapshot intact.
    const available = new Map<string, VideoSummary>();
    for (const batch of chunk(videoIds, SWEEP_BATCH_SIZE)) {
      const videos = await fetchVideos(batch);
      for (const video of videos) {
        available.set(video.id, video);
      }
    }

    // Phase 2: apply one snapshot per saved id. A missing id becomes the
    // authored placeholder, which keeps the row and its saved position.
    let refreshedCount = 0;
    let unavailableCount = 0;

    for (const videoId of videoIds) {
      const video = available.get(videoId);
      const refresh = video === undefined ? unavailableSnapshot(videoId) : snapshotFromVideo(video);

      repository.snapshots.update(refresh);

      if (video === undefined) {
        unavailableCount += 1;
      } else {
        refreshedCount += 1;
      }
    }

    // Phase 3: mark the sweep complete only after every row was written.
    repository.settings.set(LAST_SWEEP_AT_SETTING_KEY, now.toISOString(), now);

    return { status: "completed", videoCount, refreshedCount, unavailableCount };
  } catch {
    // Deliberately silent: the library page must render, and the next request
    // retries because `last_sweep_at` was not advanced.
    return { status: "failed", videoCount, refreshedCount: 0, unavailableCount: 0 };
  }
}

/**
 * Whether a stored `last_sweep_at` is absent, unparseable or older than the
 * interval. Exactly 30 days is still fresh ("older than 30 days" is strict),
 * and a future timestamp caused by clock skew is treated as fresh rather than
 * sweeping on every request.
 */
export function isSweepDue(lastSweepAt: string | undefined, now: Date): boolean {
  if (lastSweepAt === undefined) {
    return true;
  }

  const lastMs = Date.parse(lastSweepAt);
  if (!Number.isFinite(lastMs)) {
    return true;
  }

  return now.getTime() - lastMs > SWEEP_INTERVAL_MS;
}

/** The authored snapshot written when YouTube has no usable item for an id. */
export function unavailableSnapshot(videoId: string): SnapshotRefreshInput {
  return {
    videoId,
    title: UNAVAILABLE_VIDEO_TITLE,
    // The schema allows an empty channel title, and inventing one would be
    // worse than showing none.
    channelTitle: "",
    thumbnailUrl: fallbackThumbnailUrl(videoId),
    durationSeconds: null,
  };
}

/** Projects a normalized YouTube summary onto the stored snapshot shape. */
function snapshotFromVideo(video: VideoSummary): SnapshotRefreshInput {
  return {
    videoId: video.id,
    title: video.title,
    channelTitle: video.channelTitle,
    thumbnailUrl: video.thumbnailUrl,
    durationSeconds: video.durationSeconds,
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}
