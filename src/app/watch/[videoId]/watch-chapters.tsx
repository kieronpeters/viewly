"use client";

import { useMemo } from "react";

import { extractChapters, MINIMUM_CHAPTER_COUNT } from "@/components/video/description-timestamps";
import { usePlayerSeek } from "@/components/video/player-seek";

export interface WatchChaptersProps {
  /** The same plain-text description the player block renders. */
  text: string;
}

/**
 * Chapters list built from the description's timestamps (T71).
 *
 * Shown only once the description has at least two distinct timestamps, so a
 * single `0:00 Intro` line does not turn into a one-row list. Every row is a
 * `button`, never an anchor: clicking seeks the official player through the
 * shared channel and must not navigate or open a tab.
 *
 * The list is ordered by time, independent of the order the timestamps appear
 * in the description, and repeated timestamps collapse to their first mention.
 * Titles are the text after the timestamp on its line; a bare timestamp stays a
 * usable entry with no title.
 */
export function WatchChapters({ text }: WatchChaptersProps) {
  const chapters = useMemo(() => extractChapters(text), [text]);
  const playerSeek = usePlayerSeek();

  if (chapters.length < MINIMUM_CHAPTER_COUNT) {
    return null;
  }

  return (
    <section
      aria-labelledby="watch-chapters-heading"
      data-slot="watch-chapters"
      className="flex min-w-0 flex-col gap-2 border-t border-border pt-3"
    >
      <h3 id="watch-chapters-heading" className="text-sm font-semibold text-foreground">
        Chapters
      </h3>

      <ol className="flex min-w-0 flex-col gap-1">
        {chapters.map((chapter) => (
          <li key={chapter.seconds} className="min-w-0">
            <button
              type="button"
              onClick={() => playerSeek?.seekTo(chapter.seconds)}
              data-seconds={chapter.seconds}
              className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-0 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="shrink-0 tabular-nums text-foreground underline decoration-border underline-offset-4">
                {chapter.timestamp}
              </span>
              {chapter.title === "" ? null : (
                <span className="min-w-0 break-words">{chapter.title}</span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
