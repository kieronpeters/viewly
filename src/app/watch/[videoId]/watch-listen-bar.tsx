"use client";

import { Pause, Play, Volume2, VolumeX, Video } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { displayThumbnailUrl, type VideoSnapshot } from "@/features/library/video-snapshot";
import { formatDuration } from "@/shared/format";

import { ListenModeToggle } from "./watch-listen-toggle";

export interface WatchListenBarProps {
  /** Display snapshot; supplies the artwork, title and channel. */
  snapshot: VideoSnapshot;
  /** Whether the official player is currently playing. */
  isPlaying: boolean;
  /** Live position in seconds. */
  positionSeconds: number;
  /** Live duration in seconds, falling back to the snapshot. */
  durationSeconds: number;
  /** Volume in the API's 0–100 range. */
  volume: number;
  /** Whether the official player is muted. */
  isMuted: boolean;
  /** Whether the IFrame API is ready enough to accept commands. */
  isReady: boolean;
  /** Play or pause through the official player. */
  onPlayPause: () => void;
  /** Seek through the official player. */
  onSeek: (seconds: number) => void;
  /** Set volume through the official player. */
  onVolumeChange: (volume: number) => void;
  /** Mute or unmute through the official player. */
  onToggleMute: () => void;
  /** Leave listen mode and restore the normal video layout. */
  onShowVideo: () => void;
  /** Flip the persisted listen-mode preference. */
  onToggleListenMode: () => void;
}

/**
 * Compact audio-first player shown while listen mode is on (T86).
 *
 * The official YouTube iframe stays mounted and is the only player; this bar is
 * a remote control for it, not a second media element. Artwork, title and
 * channel come from the same display snapshot as the rest of the page, so a
 * podcast-style listen surface needs no extra request.
 *
 * The seek field keeps a local draft while the viewer drags or uses the arrow
 * keys; polling from the player would otherwise fight the thumb once a second.
 */
export function WatchListenBar({
  snapshot,
  isPlaying,
  positionSeconds,
  durationSeconds,
  volume,
  isMuted,
  isReady,
  onPlayPause,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onShowVideo,
  onToggleListenMode,
}: WatchListenBarProps) {
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

  const duration = Math.max(
    0,
    Math.floor(durationSeconds > 0 ? durationSeconds : (snapshot.durationSeconds ?? 0)),
  );
  const max = Math.max(1, duration);
  const position = Math.min(Math.max(0, Math.floor(seekPreview ?? positionSeconds)), max);
  const isSilent = isMuted || volume === 0;

  return (
    <div
      data-slot="watch-listen-bar"
      role="group"
      aria-label="Listen mode player"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground motion-safe:transition-colors motion-reduce:transition-none sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Image
          src={displayThumbnailUrl(snapshot.videoId, snapshot.thumbnailUrl)}
          alt=""
          width={320}
          height={180}
          className="aspect-video w-24 shrink-0 rounded-lg border border-border bg-black object-cover sm:w-32"
        />

        <div className="flex min-w-0 flex-col gap-0.5">
          <h1
            id="watch-title"
            className="line-clamp-2 min-w-0 text-pretty text-base leading-tight font-semibold tracking-tight break-words text-foreground sm:text-lg"
          >
            {snapshot.title}
          </h1>
          <p className="min-w-0 truncate text-sm text-muted-foreground">{snapshot.channelTitle}</p>
          <p className="text-xs text-muted-foreground">Listening</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:min-w-64">
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
          className="h-11 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="icon"
            aria-label={isPlaying ? "Pause" : "Play"}
            title={isPlaying ? "Pause" : "Play"}
            onClick={onPlayPause}
            disabled={!isReady}
            className="size-11 rounded-full"
          >
            {isPlaying ? (
              <Pause aria-hidden="true" className="size-5" />
            ) : (
              <Play aria-hidden="true" className="size-5" />
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isSilent ? "Unmute" : "Mute"}
            aria-pressed={isMuted}
            title={isSilent ? "Unmute" : "Mute"}
            onClick={onToggleMute}
            disabled={!isReady}
            className="size-11 text-muted-foreground"
          >
            {isSilent ? (
              <VolumeX aria-hidden="true" className="size-4" />
            ) : (
              <Volume2 aria-hidden="true" className="size-4" />
            )}
          </Button>

          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={isMuted ? 0 : Math.round(volume)}
            disabled={!isReady}
            aria-label="Volume"
            aria-valuetext={`${isMuted ? 0 : Math.round(volume)}%`}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            className="h-11 w-16 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50 sm:w-20"
          />

          <span className="tabular-nums text-xs text-muted-foreground" aria-hidden="true">
            {formatDuration(position) ?? "0:00"} / {formatDuration(duration) ?? "0:00"}
          </span>

          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <ListenModeToggle enabled onToggle={onToggleListenMode} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onShowVideo}
              className="min-h-11 gap-1.5"
            >
              <Video aria-hidden="true" className="size-4" />
              Show video
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
