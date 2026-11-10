"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { publishPlaybackEnded } from "@/components/video/playback-end";
import { subscribeToPauseRequests } from "@/components/video/playback-pause";
import { usePlayerSeek } from "@/components/video/player-seek";
import { YoutubePlayer, type YoutubePlayerHandle } from "@/components/video/youtube-player";
import { YOUTUBE_PLAYER_STATE } from "@/components/video/youtube-iframe-api";
import { clearProgress, saveProgress } from "@/features/progress/actions";
import {
  PROGRESS_REPORT_INTERVAL_MS,
  isResumableProgress,
  shouldReportProgress,
  type VideoProgress,
} from "@/features/progress/progress";
import { recordView } from "@/features/library/history-actions";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

import { WatchAmbientBackdrop } from "./watch-ambient-backdrop";
import { WatchListenBar } from "./watch-listen-bar";
import { ListenModeToggle } from "./watch-listen-toggle";
import { WatchResumePrompt } from "./watch-resume-prompt";
import { useWatchTheater } from "./watch-theater";

/** How often the listen bar samples the official player while it is visible. */
const LISTEN_STATUS_POLL_MS = 1_000;

/** The player state the listen bar renders; kept in one place to avoid drift. */
interface ListenStatus {
  isPlaying: boolean;
  positionSeconds: number;
  durationSeconds: number;
  volume: number;
  isMuted: boolean;
}

function initialListenStatus(durationSeconds: number | null): ListenStatus {
  return {
    isPlaying: false,
    positionSeconds: 0,
    durationSeconds: durationSeconds ?? 0,
    volume: 100,
    isMuted: false,
  };
}

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
  /**
   * Whether the compact audio-first layout is active (T86).
   *
   * The parent owns the persisted preference; this wrapper only renders the
   * matching presentation. The official iframe stays mounted either way, so
   * toggling never creates a second player or interrupts playback.
   */
  listenMode?: boolean;
  /** Flips listen mode; omitted on surfaces that do not offer the mode. */
  onToggleListenMode?: () => void;
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
 * ## Description timestamps (T71) and note highlights (T90)
 *
 * The wrapper also registers its seek target on the shared
 * {@link usePlayerSeek} channel, so a click on a timestamp or chapter in
 * the description reuses exactly this path: the same handle, the same
 * "remember it until ready" pending seek. No second player is created. The
 * same registration exposes the current clock, so the notes panel can anchor a
 * highlight at the position that is actually playing.
 *
 * ## Listen mode (T86)
 *
 * The parent owns the persisted preference; this wrapper only swaps the
 * presentation. The official iframe stays mounted at the same position in the
 * tree either way, so turning listen mode on or off never creates a second
 * player and never restarts playback. While the compact bar is visible, a
 * one-second poll reads the position, playback state and volume through the
 * same handle, and every bar control calls back into that handle.
 *
 * ## Failure
 *
 * History and progress are best-effort: every action call is wrapped, because
 * a failed write must never interrupt playback.
 */
export function WatchPlayer({
  snapshot,
  initialProgress = null,
  listenMode = false,
  onToggleListenMode,
}: WatchPlayerProps) {
  const recordedVideoIdRef = useRef<string | null>(null);
  const handleRef = useRef<YoutubePlayerHandle | null>(null);
  const lastReportedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Seek to apply as soon as the API is ready (prompt clicked before load). */
  const pendingSeekRef = useRef<number | null>(null);
  const [, startTransition] = useTransition();
  const playerSeek = usePlayerSeek();
  const theater = useWatchTheater();
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Previous mode, so focus moves only after a real toggle, never on load. */
  const previousListenModeRef = useRef(listenMode);

  /** Whether the IFrame API has handed us a usable handle. */
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  /** Snapshot of the official player's clock and volume, sampled for the bar. */
  const [listenStatus, setListenStatus] = useState<ListenStatus>(() =>
    initialListenStatus(snapshot.durationSeconds),
  );
  /**
   * Video the local player state belongs to.
   *
   * Navigation can reuse this component instance, so a different video must
   * reset readiness and the bar's clock during render — the pattern React
   * recommends instead of a resetting effect, which would render one frame
   * with the previous video's state.
   */
  const [stateVideoId, setStateVideoId] = useState(snapshot.videoId);

  if (stateVideoId !== snapshot.videoId) {
    setStateVideoId(snapshot.videoId);
    setIsPlayerReady(false);
    setListenStatus(initialListenStatus(snapshot.durationSeconds));
  }

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

  /**
   * Seeks the player, remembering the position when the API is not ready yet.
   *
   * One path for the resume prompt and for description timestamps/chapters
   * (T71). A NaN is ignored; negative input is clamped by the handle itself.
   */
  const seekToPosition = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) {
      return;
    }

    const handle = handleRef.current;

    if (handle === null) {
      pendingSeekRef.current = Math.max(seconds, 0);
      return;
    }

    handle.seekTo(seconds);
  }, []);

  /**
   * Samples the official player for the shared playhead channel (T90).
   *
   * The notes panel calls this when the viewer presses "Save note at current
   * time". It returns `null` until the IFrame API has handed over a handle, so
   * the panel can report "start the video" instead of saving a bogus anchor.
   */
  const readPlaybackClock = useCallback(() => {
    const handle = handleRef.current;

    if (handle === null) {
      return null;
    }

    const positionSeconds = handle.getCurrentTime();
    const durationSeconds = handle.getDuration();

    if (!Number.isFinite(positionSeconds)) {
      return null;
    }

    return {
      positionSeconds,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    };
  }, []);

  // Expose this player to description timestamps, chapters and the notes
  // panel. Registering (and unregistering) never re-renders: the controller
  // lives in a ref.
  useEffect(() => {
    if (playerSeek === null) {
      return;
    }

    const unregisterSeek = playerSeek.registerSeekTarget(seekToPosition);
    const unregisterClock = playerSeek.registerClockSource(readPlaybackClock);

    return () => {
      unregisterSeek();
      unregisterClock();
    };
  }, [playerSeek, seekToPosition, readPlaybackClock]);

  // Sleep timer (T82): the queue rail publishes a pause request through the
  // shared channel rather than reaching into the embed itself.
  useEffect(
    () =>
      subscribeToPauseRequests(() => {
        handleRef.current?.pause();
      }),
    [],
  );

  // A navigation to another video must not inherit the previous throttle gate
  // or a seek that belonged to the old player.
  useEffect(() => {
    lastReportedAtRef.current = null;
    pendingSeekRef.current = null;
  }, [snapshot.videoId]);

  // The interval is the only long-lived resource here; unmounting clears it.
  useEffect(() => stopTicker, [stopTicker]);

  /**
   * Keeps keyboard focus on the mode switch across a layout swap.
   *
   * The switch that was activated lives inside the layout that disappears, so
   * without this the focused element would become inert and the next Tab would
   * jump past the new controls. Focusing the equivalent switch in the mode that
   * just appeared keeps the toggle in place for keyboard and screen-reader users.
   */
  useEffect(() => {
    if (previousListenModeRef.current === listenMode) {
      return;
    }

    previousListenModeRef.current = listenMode;

    const root = rootRef.current;
    const selector = listenMode
      ? '[data-slot="watch-listen-bar"] [data-slot="listen-mode-toggle"]'
      : '[data-slot="watch-player-stage"] [data-slot="listen-mode-toggle"]';

    root?.querySelector<HTMLElement>(selector)?.focus();
  }, [listenMode]);

  /**
   * Samples the official player for the listen bar.
   *
   * Reads only through the T68 handle: the bar has no state of its own and no
   * media element, so the embed remains the single source of truth.
   */
  const readListenStatus = useCallback(() => {
    const handle = handleRef.current;

    if (handle === null) {
      return;
    }

    const duration = handle.getDuration() || snapshot.durationSeconds || 0;

    setListenStatus({
      isPlaying: handle.getPlaybackState() === YOUTUBE_PLAYER_STATE.PLAYING,
      positionSeconds: handle.getCurrentTime(),
      durationSeconds: duration,
      volume: handle.getVolume(),
      isMuted: handle.isMuted(),
    });
  }, [snapshot.durationSeconds]);

  // Poll only while the compact bar is visible: the video layout does not show
  // a clock, so there is nothing to sample there.
  useEffect(() => {
    if (!listenMode) {
      return;
    }

    readListenStatus();
    const timer = setInterval(readListenStatus, LISTEN_STATUS_POLL_MS);

    return () => clearInterval(timer);
  }, [listenMode, readListenStatus]);

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

    setListenStatus((status) => (status.isPlaying ? status : { ...status, isPlaying: true }));
  }, [startTicker]);

  const handlePlaybackPause = useCallback(() => {
    reportProgress(true);
    stopTicker();
    setListenStatus((status) => (status.isPlaying ? { ...status, isPlaying: false } : status));
  }, [reportProgress, stopTicker]);

  const handlePlaybackEnd = useCallback(() => {
    stopTicker();
    setListenStatus((status) => (status.isPlaying ? { ...status, isPlaying: false } : status));
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
    setIsPlayerReady(true);

    const pending = pendingSeekRef.current;

    if (pending !== null) {
      pendingSeekRef.current = null;
      handle.seekTo(pending);
    }
  }, []);

  /**
   * Listen-bar controls. Each one drives the official player through the same
   * handle as the description seek channel; the bar never creates a player.
   */
  const handleListenPlayPause = useCallback(() => {
    const handle = handleRef.current;

    if (handle === null) {
      return;
    }

    const wasPlaying = handle.getPlaybackState() === YOUTUBE_PLAYER_STATE.PLAYING;

    if (wasPlaying) {
      handle.pause();
    } else {
      handle.play();
    }

    // Optimistic icon flip; the one-second poll confirms the real state.
    setListenStatus((status) => ({ ...status, isPlaying: !wasPlaying }));
  }, []);

  const handleListenSeek = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) {
      return;
    }

    handleRef.current?.seekTo(seconds);
    setListenStatus((status) => ({ ...status, positionSeconds: seconds }));
  }, []);

  const handleListenVolume = useCallback((volume: number) => {
    if (!Number.isFinite(volume)) {
      return;
    }

    const next = Math.min(Math.max(volume, 0), 100);
    const handle = handleRef.current;

    handle?.setVolume(next);

    // Raising the volume is an intent to hear something; leaving mute on would
    // make the slider appear to do nothing.
    if (next > 0 && handle?.isMuted() === true) {
      handle.setMuted(false);
    }

    setListenStatus((status) => ({
      ...status,
      volume: next,
      isMuted: next > 0 ? false : status.isMuted,
    }));
  }, []);

  const handleListenToggleMute = useCallback(() => {
    const handle = handleRef.current;

    if (handle === null) {
      return;
    }

    // "Silent" covers both mute and a volume dragged to zero, so the control
    // always restores something audible instead of toggling a mute flag that
    // was already false.
    if (handle.isMuted() || handle.getVolume() === 0) {
      handle.setMuted(false);

      if (handle.getVolume() === 0) {
        handle.setVolume(50);
      }

      setListenStatus((status) => ({
        ...status,
        isMuted: false,
        volume: status.volume === 0 ? 50 : status.volume,
      }));

      return;
    }

    handle.setMuted(true);
    setListenStatus((status) => ({ ...status, isMuted: true }));
  }, []);

  const toggleListenMode = useCallback(() => {
    onToggleListenMode?.();
  }, [onToggleListenMode]);

  function handleResume() {
    setDismissedResumeKey(resumeKey);

    if (resumePosition === null) {
      return;
    }

    seekToPosition(resumePosition);
  }

  function handleStartOver() {
    setDismissedResumeKey(resumeKey);
    seekToPosition(0);

    startTransition(async () => {
      try {
        await clearProgress(snapshot.videoId);
      } catch {
        // Starting over is a UI intent; a failed clear must not block playback.
      }
    });
  }

  return (
    <div
      ref={rootRef}
      data-slot="watch-player"
      data-listen-mode={listenMode ? "true" : "false"}
      className="relative isolate flex min-w-0 flex-col gap-2"
    >
      <WatchAmbientBackdrop snapshot={snapshot} />

      {isResumeVisible && resumePosition !== null ? (
        <WatchResumePrompt
          positionSeconds={resumePosition}
          durationSeconds={initialProgress?.durationSeconds ?? 0}
          onResume={handleResume}
          onStartOver={handleStartOver}
        />
      ) : null}

      {/*
        Fixed slot for the compact bar. It is always the second child (after the
        optional resume prompt) so switching modes never moves the player's
        stage in the tree; moving it would remount the iframe and create a
        second player.
      */}
      <div data-slot="watch-listen-slot">
        {listenMode ? (
          <WatchListenBar
            snapshot={snapshot}
            isPlaying={listenStatus.isPlaying}
            positionSeconds={listenStatus.positionSeconds}
            durationSeconds={listenStatus.durationSeconds}
            volume={listenStatus.volume}
            isMuted={listenStatus.isMuted}
            isReady={isPlayerReady}
            onPlayPause={handleListenPlayPause}
            onSeek={handleListenSeek}
            onVolumeChange={handleListenVolume}
            onToggleMute={handleListenToggleMute}
            onShowVideo={toggleListenMode}
            onToggleListenMode={toggleListenMode}
          />
        ) : null}
      </div>

      {/*
        The official embed is the one and only player. Listen mode keeps it
        mounted (playback continues) but removes it from view and from the
        accessibility tree, so the bar is the only visible control surface.
      */}
      <div
        data-slot="watch-player-stage"
        className={listenMode ? "sr-only" : undefined}
        aria-hidden={listenMode ? true : undefined}
        inert={listenMode ? true : undefined}
      >
        <YoutubePlayer
          videoId={snapshot.videoId}
          title={snapshot.title}
          onPlaybackStart={handlePlaybackStart}
          onPlaybackPlay={handlePlaybackPlay}
          onPlaybackPause={handlePlaybackPause}
          onPlayerReady={handlePlayerReady}
          onPlaybackEnd={handlePlaybackEnd}
          onToggleTheater={theater.toggleTheater}
          modeControl={<ListenModeToggle enabled={listenMode} onToggle={toggleListenMode} />}
        />
      </div>
    </div>
  );
}
