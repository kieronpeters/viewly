"use client";

import { Pause, Play, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { displayThumbnailUrl, type VideoSnapshot } from "@/features/library/video-snapshot";
import { formatDuration } from "@/shared/format";

export interface MiniPlayerProps {
  /** Display snapshot of the video that keeps playing. */
  snapshot: VideoSnapshot;
  /** Whether the official player is currently playing. */
  isPlaying: boolean;
  /** Live position in seconds. */
  positionSeconds: number;
  /** Live duration in seconds, falling back to the snapshot. */
  durationSeconds: number;
  /** Whether the IFrame API is ready enough to accept commands. */
  isReady: boolean;
  /** Play or pause through the official player. */
  onPlayPause: () => void;
  /** Seek through the official player. */
  onSeek: (seconds: number) => void;
  /** Close the mini player; the shell then releases the video. */
  onClose: () => void;
}

/**
 * Persistent mini-player shown on every route except the watch page (T75).
 *
 * It is a remote control for the same official embed the watch page uses: no
 * second media element, no audio of its own. Artwork, title and channel come
 * from the display snapshot the watch page already supplied, so appearing on
 * `/`, `/search` or `/library` costs no extra request.
 *
 * ## Not a dialog
 *
 * The card is an ordinary named `<section>`, not a modal: it does not set
 * `aria-modal`, does not trap focus and installs no key handler, so `Escape`
 * keeps doing whatever the current page does with it, and Tab continues into
 * the rest of the document. Every control is a real button, link or range
 * input. The one layout constraint is placement: it sits above the mobile
 * bottom navigation (see the shell wrapper) instead of covering it.
 *
 * The seek field keeps a local draft while the viewer drags or uses the arrow
 * keys, because the one-second sample from the official player would otherwise
 * fight the thumb.
 */
export function MiniPlayer({
  snapshot,
  isPlaying,
  positionSeconds,
  durationSeconds,
  isReady,
  onPlayPause,
  onSeek,
  onClose,
}: MiniPlayerProps) {
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

  const duration = Math.max(
    0,
    Math.floor(durationSeconds > 0 ? durationSeconds : (snapshot.durationSeconds ?? 0)),
  );
  const max = Math.max(1, duration);
  const position = Math.min(Math.max(0, Math.floor(seekPreview ?? positionSeconds)), max);
  const watchHref = `/watch/${snapshot.videoId}`;

  return (
    <section
      data-slot="mini-player"
      aria-label="Mini player"
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-2.5 text-card-foreground shadow-lg motion-safe:transition-colors motion-reduce:transition-none"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={watchHref}
          aria-label={`Open ${snapshot.title}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Image
            src={displayThumbnailUrl(snapshot.videoId, snapshot.thumbnailUrl)}
            alt=""
            width={160}
            height={90}
            className="aspect-video w-16 shrink-0 rounded-md border border-border bg-black object-cover"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">{snapshot.title}</span>
            <span className="truncate text-xs text-muted-foreground">{snapshot.channelTitle}</span>
          </span>
        </Link>

        <Button
          type="button"
          size="icon"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
          onClick={onPlayPause}
          disabled={!isReady}
          className="size-10 shrink-0 rounded-full"
        >
          {isPlaying ? (
            <Pause aria-hidden="true" className="size-4" />
          ) : (
            <Play aria-hidden="true" className="size-4" />
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close mini player"
          title="Close mini player"
          onClick={onClose}
          className="size-10 shrink-0 text-muted-foreground"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={position}
          disabled={!isReady || duration === 0}
          aria-label="Seek"
          aria-valuetext={`${formatDuration(position) ?? "0:00"} of ${formatDuration(duration) ?? "0:00"}`}
          onChange={(event) => {
            const next = Number(event.target.value);

            setSeekPreview(next);
            onSeek(next);
          }}
          onPointerUp={() => setSeekPreview(null)}
          onKeyUp={() => setSeekPreview(null)}
          onBlur={() => setSeekPreview(null)}
          className="h-8 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        />

        <span className="shrink-0 tabular-nums text-xs text-muted-foreground" aria-hidden="true">
          {formatDuration(position) ?? "0:00"} / {formatDuration(duration) ?? "0:00"}
        </span>
      </div>
    </section>
  );
}
