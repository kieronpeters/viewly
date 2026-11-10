"use client";

import { useCallback, useEffect, type ReactNode } from "react";

import { usePlayerHost, usePlayerStageHeight } from "@/components/player/player-provider";
import type { VideoSnapshot } from "@/features/library/video-snapshot";
import type { VideoProgress } from "@/features/progress/progress";
import { useIsomorphicLayoutEffect } from "@/lib/use-isomorphic-layout-effect";

import { useListenModePreference } from "./listen-mode-preference";
import { useWatchTheaterControls } from "./watch-theater";
import { WatchTheaterToggle } from "./watch-theater-toggle";
import { WatchPlayer } from "./watch-player";

export interface WatchPlayerColumnProps {
  /** Display snapshot; the player and the listen bar both read it. */
  snapshot: VideoSnapshot;
  /** Server-read local progress, forwarded to the player's resume prompt. */
  initialProgress?: VideoProgress | null;
  /**
   * Title, channel and action row.
   *
   * The listen bar repeats the title and channel, so the full block is swapped
   * out while listen mode is on; the viewer gets it back, unchanged, when they
   * return to the video layout.
   */
  meta: ReactNode;
  /** Description and discussion, shown under either player layout. */
  children: ReactNode;
}

/**
 * Client boundary that owns the watch page's listen-mode preference (T86).
 *
 * ## Where the player went (T75)
 *
 * The player no longer belongs to this route. It is owned by the shell's
 * `PlayerProvider`, which mounts one embed for the whole session, so navigating
 * from `/watch/[id]` to `/`, `/search` or `/library` keeps the iframe alive.
 * This column activates the track (a layout effect, so the player docks before
 * the first paint) and renders an empty **stage slot**: the provider measures it
 * and positions the docked surface over it. When listen mode is on the same
 * slot reserves the compact bar's height instead; the embed stays mounted.
 *
 * A column rendered outside the shell (an isolated preview or a unit test) has
 * no provider; it then renders the player itself, exactly as before T75. That
 * fallback is deliberate: it keeps the component usable on its own without
 * ever creating a second player in the real app.
 *
 * In listen mode the meta block (title, channel, save actions) is unmounted
 * rather than hidden with CSS: the compact bar renders the same title as the
 * page's only `h1`, so there is no duplicate heading, id or tab stop behind the
 * bar. The preference is persisted in `localStorage`; the provider subscribes to
 * the same store, so the docked bar and this layout never disagree.
 *
 * Theater mode (T70) is a grid-level preference owned by `WatchTheaterProvider`.
 * Its visible switch sits outside the player stage, so it stays reachable in
 * both video and listen layouts; `T` is forwarded to the shell player through
 * `registerTheaterToggle`, because the embed now lives above this route.
 */
export function WatchPlayerColumn({
  snapshot,
  initialProgress = null,
  meta,
  children,
}: WatchPlayerColumnProps) {
  const [listenMode, setListenMode] = useListenModePreference();
  const toggleListenMode = useCallback(() => {
    setListenMode(!listenMode);
  }, [listenMode, setListenMode]);
  const theater = useWatchTheaterControls();
  const playerHost = usePlayerHost();
  const stageHeight = usePlayerStageHeight();

  /**
   * Callback ref for the docked slot.
   *
   * A `useCallback` wrapper rather than the controller method directly: the ref
   * is only invoked on mount/unmount, while the controller method is a setter
   * that React's lint rules must not mistake for a render-time ref read.
   */
  const registerStage = useCallback(
    (element: HTMLDivElement | null) => {
      playerHost?.registerStage(element);
    },
    [playerHost],
  );

  // Claim the shell player for this route. The cleanup only releases the route:
  // the track keeps playing in the mini player instead of being destroyed.
  useIsomorphicLayoutEffect(() => {
    if (playerHost === null) {
      return;
    }

    return playerHost.activateWatch({ snapshot, initialProgress });
  }, [playerHost, snapshot, initialProgress]);

  // The embed is above the route's theater provider, so the `T` shortcut is
  // forwarded rather than read from context there.
  useEffect(() => {
    if (playerHost === null || theater === null) {
      return;
    }

    return playerHost.registerTheaterToggle(theater.toggleTheater);
  }, [playerHost, theater]);

  return (
    <div
      data-slot="watch-primary-column"
      data-listen-mode={listenMode ? "true" : "false"}
      className="flex min-w-0 flex-col gap-4"
    >
      {theater === null ? null : (
        <div data-slot="watch-theater-toolbar" className="flex justify-end">
          <WatchTheaterToggle enabled={theater.isTheater} onToggle={theater.toggleTheater} />
        </div>
      )}

      <section
        data-slot="watch-player-slot"
        aria-labelledby="watch-player-heading"
        className="flex min-w-0 flex-col"
      >
        <h2 id="watch-player-heading" className="sr-only">
          {listenMode ? "Audio player" : "Video player"}
        </h2>

        {playerHost === null ? (
          <WatchPlayer
            snapshot={snapshot}
            initialProgress={initialProgress}
            listenMode={listenMode}
            onToggleListenMode={toggleListenMode}
          />
        ) : (
          /*
           * The docked player is `position: fixed`, so this slot is what keeps
           * the page from jumping under it: it reserves the measured height of
           * the real surface (16:9 box plus controls, or the listen bar).
           */
          <div
            ref={registerStage}
            data-slot="watch-player-stage-slot"
            style={stageHeight === null ? undefined : { minHeight: stageHeight }}
            className={stageHeight === null && !listenMode ? "aspect-video w-full" : "w-full"}
          />
        )}
      </section>

      {listenMode ? null : (
        <div data-slot="watch-meta" className="flex min-w-0 flex-col gap-3">
          {meta}
        </div>
      )}

      <div data-slot="watch-details" className="flex min-w-0 flex-col gap-3">
        {children}
      </div>
    </div>
  );
}
