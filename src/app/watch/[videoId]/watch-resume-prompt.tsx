"use client";

import { Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { progressPercent } from "@/features/progress/progress";
import { formatDuration } from "@/shared/format";

export interface WatchResumePromptProps {
  /** Stored position in whole seconds; already known to be resumable. */
  positionSeconds: number;
  /** Total duration in whole seconds. */
  durationSeconds: number;
  /** Seeks the player to the stored position. */
  onResume: () => void;
  /** Clears the stored position and starts from the beginning. */
  onStartOver: () => void;
}

/**
 * "Resume from m:ss" prompt shown above the player (T68).
 *
 * Rendered only for a stored position between 5% and 95%. It is presentational:
 * the watch player owns the seek and the `clearProgress` write, so this
 * component stays trivially testable and never reaches the database.
 *
 * Both buttons are ordinary `<button>` elements rather than a dialog, because
 * the prompt is non-modal — the viewer can ignore it and press YouTube's own
 * play button, which simply starts from the beginning.
 */
export function WatchResumePrompt({
  positionSeconds,
  durationSeconds,
  onResume,
  onStartOver,
}: WatchResumePromptProps) {
  const position = formatDuration(positionSeconds) ?? "0:00";
  const percent = progressPercent(positionSeconds, durationSeconds);

  return (
    <div
      data-slot="watch-resume-prompt"
      role="group"
      aria-label="Resume playback"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-card-foreground"
    >
      <p className="min-w-0 text-sm">
        <span className="font-medium">You stopped at {position}.</span>{" "}
        <span className="text-muted-foreground">{percent}% watched</span>
      </p>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" variant="secondary" onClick={onResume} className="min-h-9">
          <Play aria-hidden="true" className="size-3.5" />
          Resume from {position}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onStartOver}
          className="min-h-9 gap-1"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Start over
        </Button>
      </div>
    </div>
  );
}
