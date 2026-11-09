"use client";

import { useRef, useTransition } from "react";

import { YoutubePlayer } from "@/components/video/youtube-player";
import { recordView } from "@/features/library/history-actions";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

export interface WatchPlayerProps {
  /**
   * Display snapshot projected on the server from the normalized video.
   *
   * Passing the snapshot instead of the whole `VideoDetail` keeps the client
   * payload small (the description never crosses the boundary) and gives the
   * action exactly the shape it validates.
   */
  snapshot: VideoSnapshot;
}

/**
 * Watch-route player with viewing-history recording (T35).
 *
 * The player itself is presentational: it knows when playback starts and
 * exposes {@link YoutubePlayer}'s `onPlaybackStart`, but it never touches the
 * library. This wrapper is the client boundary that owns the write: it receives
 * the video snapshot the server rendered, calls the `recordView` Server Action
 * on the first `PLAYING` state, and keeps playback independent of the result.
 *
 * ## Once per video
 *
 * The player already fires the callback once per mount. The ref here is a
 * second guard, keyed by video id, so a reused component instance cannot
 * double-record the same video and a failure cannot start a retry loop. A
 * different video resets the guard.
 *
 * ## Never on load
 *
 * `autoplay` is off, so mounting the page reports `UNSTARTED`/`CUED`, not
 * `PLAYING`; only a real press of YouTube's play button reaches this code. The
 * action re-validates the snapshot, so a malformed or missing video is rejected
 * before any row is written.
 */
export function WatchPlayer({ snapshot }: WatchPlayerProps) {
  const recordedVideoIdRef = useRef<string | null>(null);
  const [, startTransition] = useTransition();

  function handlePlaybackStart() {
    if (recordedVideoIdRef.current === snapshot.videoId) {
      return;
    }

    recordedVideoIdRef.current = snapshot.videoId;

    startTransition(async () => {
      try {
        await recordView(snapshot);
      } catch {
        // History is best-effort: a failed write must never interrupt playback.
      }
    });
  }

  return (
    <YoutubePlayer
      videoId={snapshot.videoId}
      title={snapshot.title}
      onPlaybackStart={handlePlaybackStart}
    />
  );
}
