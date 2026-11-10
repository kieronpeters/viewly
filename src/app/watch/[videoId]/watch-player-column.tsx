"use client";

import { useCallback, type ReactNode } from "react";

import type { VideoSnapshot } from "@/features/library/video-snapshot";
import type { VideoProgress } from "@/features/progress/progress";

import { useListenModePreference } from "./listen-mode-preference";
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
 * The player route was previously a single server-rendered column. Only the
 * mode is interactive, so this thin wrapper owns that one bit of state and
 * hands it to {@link WatchPlayer}; everything it does not need to change —
 * description, chapters and discussion — arrives as already-rendered children
 * and stays mounted across a mode switch.
 *
 * In listen mode the meta block (title, channel, save actions) is unmounted
 * rather than hidden with CSS: the compact bar renders the same title as the
 * page's only `h1`, so there is no duplicate heading, id or tab stop behind the
 * bar. The preference is persisted in `localStorage` by the hook.
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

  return (
    <div
      data-slot="watch-primary-column"
      data-listen-mode={listenMode ? "true" : "false"}
      className="flex min-w-0 flex-col gap-4"
    >
      <section
        data-slot="watch-player-slot"
        aria-labelledby="watch-player-heading"
        className="flex min-w-0 flex-col"
      >
        <h2 id="watch-player-heading" className="sr-only">
          {listenMode ? "Audio player" : "Video player"}
        </h2>
        <WatchPlayer
          snapshot={snapshot}
          initialProgress={initialProgress}
          listenMode={listenMode}
          onToggleListenMode={toggleListenMode}
        />
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
