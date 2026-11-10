"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

/** Entry point a mounted player provides; it seeks the official embed. */
export type PlayerSeekTarget = (seconds: number) => void;

/** A sampled playback position from the official embed. */
export interface PlayerClock {
  /** Current position in seconds, as reported by the IFrame API. */
  positionSeconds: number;
  /** Total duration in seconds; `0` while the API does not know it. */
  durationSeconds: number;
}

/** Entry point a mounted player provides; it reads the current clock. */
export type PlayerClockSource = () => PlayerClock | null;

/**
 * The watch page's single seek/playhead channel.
 *
 * The player owns the YouTube handle (T68), so it registers a target once it is
 * mounted and description timestamps and notes only ever call `seekTo`. The
 * same registration exposes the current clock, so the notes panel can save a
 * highlight at the position that is actually playing (T90) without holding a
 * second player handle. Nothing here touches the IFrame API.
 */
export interface PlayerSeekController {
  /**
   * Registers the active player's seek target and returns an unregister
   * function. Unregistering only clears the target if it is still this one, so
   * a late unmount cannot remove a newer player's target.
   */
  registerSeekTarget(target: PlayerSeekTarget): () => void;
  /** Seeks the registered player, ignoring a missing player or a bad value. */
  seekTo(seconds: number): void;
  /**
   * Registers the active player's clock source and returns an unregister
   * function, with the same "only clear my own registration" rule.
   */
  registerClockSource(source: PlayerClockSource): () => void;
  /** The current position and duration, or `null` when no player is ready. */
  getPlaybackClock(): PlayerClock | null;
}

const PlayerSeekContext = createContext<PlayerSeekController | null>(null);

/** Provides one seek/playhead channel to every player-aware child in the watch column. */
export function PlayerSeekProvider({ children }: { readonly children: ReactNode }) {
  const targetRef = useRef<PlayerSeekTarget | null>(null);
  const clockRef = useRef<PlayerClockSource | null>(null);

  const controller = useMemo<PlayerSeekController>(
    () => ({
      registerSeekTarget(target) {
        targetRef.current = target;

        return () => {
          if (targetRef.current === target) {
            targetRef.current = null;
          }
        };
      },
      seekTo(seconds) {
        if (!Number.isFinite(seconds)) {
          return;
        }

        targetRef.current?.(seconds);
      },
      registerClockSource(source) {
        clockRef.current = source;

        return () => {
          if (clockRef.current === source) {
            clockRef.current = null;
          }
        };
      },
      getPlaybackClock() {
        return clockRef.current?.() ?? null;
      },
    }),
    [],
  );

  return <PlayerSeekContext.Provider value={controller}>{children}</PlayerSeekContext.Provider>;
}

/**
 * The active seek channel, or `null` outside the watch column.
 *
 * `null` is a valid state rather than an error: a description rendered on its
 * own (a preview, a test, another surface) still shows its timestamps, they are
 * simply inert until a player is present.
 */
export function usePlayerSeek(): PlayerSeekController | null {
  return useContext(PlayerSeekContext);
}
