"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useWatchTheater } from "./watch-theater";

export interface WatchStageLayoutProps {
  /** The player column, already rendered by the server component. */
  children: ReactNode;
  /** The Up next rail content (suggestions and queue). */
  rail: ReactNode;
}

/**
 * The watch page's responsive grid, with theater mode (T70).
 *
 * Theater removes the 20–22.5rem rail column at `lg` and above, so the player
 * column — and the 16:9 embed inside it — widens to the full page width. The
 * layout below `lg` is already a single column, so theater deliberately has no
 * effect there.
 *
 * ## Why the rail is hidden, not unmounted
 *
 * `lg:hidden` keeps the suggestions and the queue mounted. Toggling theater
 * therefore never refetches suggestions, loses the queue's sleep-timer state or
 * shifts focus out of a rail control; toggling back restores exactly the same
 * subtree. The grid itself is not animated: changing `grid-template-columns`
 * would reflow every frame and is exactly the "layout shift" theater must
 * avoid, so the new width applies in one paint.
 */
export function WatchStageLayout({ children, rail }: WatchStageLayoutProps) {
  const { isTheater } = useWatchTheater();

  return (
    <div
      data-slot="watch-stage-layout"
      data-theater={isTheater ? "true" : "false"}
      className={cn(
        "grid min-w-0 grid-cols-1 items-start gap-x-6 gap-y-5",
        isTheater
          ? "lg:grid-cols-1"
          : "lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22.5rem]",
      )}
    >
      {children}

      <aside
        data-slot="watch-up-next-slot"
        aria-label="Suggested videos"
        className={cn(
          "min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto",
          isTheater && "lg:hidden",
        )}
      >
        {rail}
      </aside>
    </div>
  );
}
