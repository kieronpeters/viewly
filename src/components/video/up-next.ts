import type { VideoSummary } from "@/shared/types";

/**
 * How long the rail waits before navigating to the next suggestion.
 *
 * T69 keeps this deliberately short: the countdown is a visible, cancellable
 * five-second window, not a background autoplay queue.
 */
export const UP_NEXT_COUNTDOWN_SECONDS = 5;

/**
 * Picks the video the "Up next" rail will offer after playback ends.
 *
 * The server already filters the current video out of `videos`, but the
 * selector repeats the rule on the client so a stale prop, a cached payload or
 * a future caller can never navigate a viewer back to the video they just
 * finished. Returns `null` when there is nothing else to play.
 */
export function selectUpNextVideo(
  videos: readonly VideoSummary[],
  currentVideoId: string,
): VideoSummary | null {
  return videos.find((video) => video.id !== currentVideoId) ?? null;
}
