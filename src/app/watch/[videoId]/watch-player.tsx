"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { publishPlaybackEnded } from "@/components/video/playback-end";
import { YoutubePlayer, type YoutubePlayerHandle } from "@/components/video/youtube-player";
import { clearProgress, saveProgress } from "@/features/progress/actions";
import {
  PROGRESS_REPORT_INTERVAL_MS,
  isResumableProgress,
  shouldReportProgress,
  type VideoProgress,
} from "@/features/progress/progress";
import { recordView } from "@/features/library/history-actions";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

import { WatchResumePrompt } from "./watch-resume-prompt";

export interface WatchPlayerProps {
  /**
   * Display snapshot projected on the server from the normalized video.
   *
   * Passing the snapshot instead of the whole `VideoDetail` keeps the client
   * payload small (the description never crosses the boundary) and gives the
   * action exactly the shape it validates.
   */
  snapshot: VideoSnapshot;
  /**
   * Server-read local progress for this video, or `null` when there is none.
   *
   * Only a position between 5% and 95% becomes a prompt; everything else is
   * treated as "start from the beginning" (and a finished video's row is
   * cleared by the action that reports it).
   */
  initialProgress?: VideoProgress | null;
}

/**
 * Watch-route player with viewing-history recording (T35) and local progress
 * (T68).
 *
 * The player itself is presentational: it owns YouTube's IFrame instance and
 * exposes a small {@link YoutubePlayerHandle}, but it never touches the
 * database. This wrapper is the client boundary that owns every write:
 *
 * - on the first `PLAYING` it records the view, exactly once per video;
 * - while playing it reads the position every five seconds and reports it
 *   through `saveProgress`, throttled by {@link shouldReportProgress};
 * - on pause it flushes one last position and stops the timer;
 * - on `ENDED` it clears the row, so a finished video is never offered for
 *   resume.
 *
 * ## Resume prompt
 *
 * A stored position is offered as "Resume from m:ss" (5%-95%). Resuming seeks
 * the player — or is remembered until the API is ready — and dismissing the
 * prompt is local UI state, so the parent's server-rendered progress is never
 * mutated by merely looking at it. "Start over" seeks to zero and calls
 * `clearProgress`.
 *
 * ## Failure
 *
 * History and progress are best-effort: every action call is wrapped, because
 * a failed write must never interrupt playback.
 */
export function WatchPlayer({ snapshot, initialProgress = null }: WatchPlayerProps) {
  const recordedVideoIdRef = useRef<string | null>(null);
  const handleRef = useRef<YoutubePlayerHandle | null>(null);
  const lastReportedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Seek to apply as soon as the API is ready (prompt clicked before load). */
  const pendingSeekRef = useRef<number | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Local dismissal key, `"<videoId>:<position>"`.
   *
   * State rather than an effect: a new video or a different stored position
   * produces a new key and the prompt appears again, while dismissing one
   * prompt cannot leak into the next video.
   */
  const [dismissedResumeKey, setDismissedResumeKey] = useState<string | null>(null);

  const resumePosition =
    initialProgress !== null &&
    isResumableProgress(initialProgress.positionSeconds, initialProgress.durationSeconds)
      ? initialProgress.positionSeconds
      : null;
  const resumeKey = resumePosition === null ? null : `${snapshot.videoId}:${resumePosition}`;
  const isResumeVisible = resumeKey !== null && resumeKey !== dismissedResumeKey;

  const stopTicker = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Reads the current position and sends it, if the throttle allows.
   *
   * `force` is used on pause, where one last write is worth bypassing the
   * five-second gate. Both paths still skip a position under one second, so a
   * page that never actually played never writes a row.
   */
  const reportProgress = useCallback(
    (force = false) => {
      const handle = handleRef.current;

      if (handle === null) {
        return;
      }

      const position = handle.getCurrentTime();
      const duration = handle.getDuration();

      if (!Number.isFinite(position) || !Number.isFinite(duration)) {
        return;
      }

      if (position < 1 || duration <= 0) {
        return;
      }

      const now = Date.now();

      if (!force && !shouldReportProgress(lastReportedAtRef.current, now)) {
        return;
      }

      lastReportedAtRef.current = now;

      startTransition(async () => {
        try {
          await saveProgress(snapshot.videoId, position, duration);
        } catch {
          // Progress is best-effort: a failed write never interrupts playback.
        }
      });
    },
    [snapshot.videoId, startTransition],
  );

  const startTicker = useCallback(() => {
    stopTicker();
    timerRef.current = setInterval(() => reportProgress(), PROGRESS_REPORT_INTERVAL_MS);
  }, [reportProgress, stopTicker]);

  // A navigation to another video must not inherit the previous throttle gate
  // or a seek that belonged to the old player.
  useEffect(() => {
    lastReportedAtRef.current = null;
    pendingSeekRef.current = null;
  }, [snapshot.videoId]);

  // The interval is the only long-lived resource here; unmounting clears it.
  useEffect(() => stopTicker, [stopTicker]);

  const handlePlaybackStart = useCallback(() => {
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
  }, [snapshot, startTransition]);

  const handlePlaybackPlay = useCallback(() => {
    if (timerRef.current === null) {
      startTicker();
    }
  }, [startTicker]);

  const handlePlaybackPause = useCallback(() => {
    reportProgress(true);
    stopTicker();
  }, [reportProgress, stopTicker]);

  const handlePlaybackEnd = useCallback(() => {
    stopTicker();
    publishPlaybackEnded(snapshot.videoId);

    startTransition(async () => {
      try {
        await clearProgress(snapshot.videoId);
      } catch {
        // Completion is best-effort: the page must not throw on a failed clear.
      }
    });
  }, [snapshot.videoId, startTransition, stopTicker]);

  const handlePlayerReady = useCallback((handle: YoutubePlayerHandle) => {
    handleRef.current = handle;

    const pending = pendingSeekRef.current;

    if (pending !== null) {
      pendingSeekRef.current = null;
      handle.seekTo(pending);
    }
  }, []);

  function handleResume() {
    setDismissedResumeKey(resumeKey);

    if (resumePosition === null) {
      return;
    }

    const handle = handleRef.current;

    if (handle === null) {
      // The prompt can be clicked before the embed is ready; apply it then.
      pendingSeekRef.current = resumePosition;
      return;
    }

    handle.seekTo(resumePosition);
  }

  function handleStartOver() {
    setDismissedResumeKey(resumeKey);

    const handle = handleRef.current;

    if (handle === null) {
      pendingSeekRef.current = 0;
    } else {
      handle.seekTo(0);
    }

    startTransition(async () => {
      try {
        await clearProgress(snapshot.videoId);
      } catch {
        // Starting over is a UI intent; a failed clear must not block playback.
      }
    });
  }

  return (
    <div data-slot="watch-player" className="flex min-w-0 flex-col gap-2">
      {isResumeVisible && resumePosition !== null ? (
        <WatchResumePrompt
          positionSeconds={resumePosition}
          durationSeconds={initialProgress?.durationSeconds ?? 0}
          onResume={handleResume}
          onStartOver={handleStartOver}
        />
      ) : null}

      <YoutubePlayer
        videoId={snapshot.videoId}
        title={snapshot.title}
        onPlaybackStart={handlePlaybackStart}
        onPlaybackPlay={handlePlaybackPlay}
        onPlaybackPause={handlePlaybackPause}
        onPlayerReady={handlePlayerReady}
        onPlaybackEnd={handlePlaybackEnd}
      />
    </div>
  );
}
