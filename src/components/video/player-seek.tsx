"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

/** Entry point a mounted player provides; it seeks the official embed. */
export type PlayerSeekTarget = (seconds: number) => void;

/**
 * The watch page's single seek channel.
 *
 * The player owns the YouTube handle (T68), so it registers a target once it is
 * mounted and description timestamps only ever call `seekTo`. Nothing here
 * touches the IFrame API, and future player features can share the same channel
 * instead of creating a second player or a custom video element.
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
}

const PlayerSeekContext = createContext<PlayerSeekController | null>(null);

/** Provides one seek channel to every player-aware child in the watch column. */
export function PlayerSeekProvider({ children }: { readonly children: ReactNode }) {
  const targetRef = useRef<PlayerSeekTarget | null>(null);

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
