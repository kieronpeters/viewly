"use client";

import { Check, ListPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration, formatViewCount } from "@/shared/format";
import type { VideoSummary } from "@/shared/types";

import { useAutoplayPreference } from "./autoplay-preference";
import {
  clearPlaybackEndedEvent,
  getPlaybackEndedEvent,
  subscribeToPlaybackEnded,
} from "./playback-end";
import { selectUpNextVideo, UP_NEXT_COUNTDOWN_SECONDS } from "./up-next";
import {
  addVideoToQueue,
  getWatchQueue,
  isVideoQueued,
  removeVideoFromQueue,
  selectQueueAutoplayVideo,
  useWatchQueue,
} from "./watch-queue-store";

export interface VideoSuggestionsProps {
  /** Already filtered, de-duplicated and capped by `selectVideoSuggestions`. */
  videos: readonly VideoSummary[];
  /** Current video id; the countdown never navigates back to it. */
  currentVideoId: string;
  className?: string;
}

/** Id of the section heading; a single instance exists on the watch page. */
const HEADING_ID = "watch-up-next-heading";

/** The rail thumbnail is 160px wide at every breakpoint. */
const THUMBNAIL_SIZES = "160px";

/**
 * Compact "Up next" rail beside the player (T32, restyled by T77, T69 adds the
 * end-of-playback hand-off).
 *
 * One row per suggestion: 16:9 thumbnail with the duration badge, then title,
 * channel and view count. The rows are deliberately much denser than the old
 * card grid so the 360px rail can show several candidates without scrolling
 * the page.
 *
 * ## Up next + optional autoplay
 *
 * The first candidate that is not the current video is always highlighted.
 * When the player reports `ENDED` (through {@link subscribeToPlaybackEnded})
 * and the viewer has switched autoplay on, the rail shows a five-second
 * countdown for that candidate and then uses the App Router to navigate to it.
 * With autoplay off — the default — `ENDED` changes nothing.
 *
 * Cancel stops the countdown before navigation; Skip navigates immediately.
 * Both are real buttons, so they work with a pointer, Enter/Space, and Escape
 * cancels from anywhere on the page while the countdown is visible. The
 * progress bar has a text equivalent via its `role="progressbar"` value, and
 * its only animation is the width transition, which is disabled under
 * `prefers-reduced-motion` (the app-wide stylesheet also collapses animations
 * for that preference).
 *
 * Presentational data still comes from the caller: the server component owns
 * the fetch and the Suspense boundary, so no second API call happens here.
 */
export function VideoSuggestions({ videos, currentVideoId, className }: VideoSuggestionsProps) {
  const router = useRouter();
  const [autoplayEnabled, setAutoplayEnabled] = useAutoplayPreference();
  const queue = useWatchQueue();

  const nextVideo = useMemo(
    () => selectUpNextVideo(videos, currentVideoId),
    [videos, currentVideoId],
  );

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const consumedSequenceRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);

  // Subscribe to the player's ENDED signal. The callback is the external
  // system's notification, so updating the countdown here is the supported
  // pattern (and the subscription is re-created when its inputs change).
  useEffect(() => {
    let cancelled = false;

    const processEndedEvent = () => {
      if (cancelled) {
        return;
      }

      const event = getPlaybackEndedEvent();

      if (event === null || event.videoId !== currentVideoId) {
        return;
      }

      if (consumedSequenceRef.current === event.sequence) {
        return;
      }

      // The queue owns the hand-off whenever it has a waiting item. Leave the
      // event untouched so WatchQueue can start its countdown; otherwise both
      // rails would race to navigate to the same video.
      if (selectQueueAutoplayVideo(getWatchQueue(), currentVideoId) !== null) {
        return;
      }

      // Consume every ENDED for this video, whether or not autoplay is on, so
      // switching the toggle afterwards cannot resurrect a finished video.
      consumedSequenceRef.current = event.sequence;
      clearPlaybackEndedEvent(event);

      if (!autoplayEnabled || nextVideo === null) {
        return;
      }

      navigatedRef.current = false;
      setRemainingSeconds(UP_NEXT_COUNTDOWN_SECONDS);
    };

    const unsubscribe = subscribeToPlaybackEnded(processEndedEvent);

    // The rail streams in behind its own Suspense boundary, so it can mount a
    // moment after the player already ended. The store keeps the latest event;
    // process it once the subscription is live.
    queueMicrotask(processEndedEvent);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentVideoId, autoplayEnabled, nextVideo]);

  const isCountingDown = remainingSeconds !== null;

  // Escape cancels from anywhere on the page, as the countdown hint promises.
  // `defaultPrevented` lets a dialog that already handled the key (for example
  // the shortcuts panel) win without also stopping this countdown.
  useEffect(() => {
    if (!isCountingDown) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      setRemainingSeconds(null);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCountingDown]);

  useEffect(() => {
    if (!isCountingDown) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((current) => (current === null ? null : Math.max(0, current - 1)));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isCountingDown]);

  // `0` is the commit point: the interval has already shown the final second.
  useEffect(() => {
    if (remainingSeconds !== 0 || nextVideo === null || navigatedRef.current) {
      return;
    }

    navigatedRef.current = true;
    router.push(`/watch/${nextVideo.id}`);
  }, [remainingSeconds, nextVideo, router]);

  const cancelCountdown = useCallback(() => {
    setRemainingSeconds(null);
  }, []);

  const skipToNext = useCallback(() => {
    if (nextVideo === null || navigatedRef.current) {
      return;
    }

    navigatedRef.current = true;
    setRemainingSeconds(null);
    router.push(`/watch/${nextVideo.id}`);
  }, [nextVideo, router]);

  function handleAutoplayToggle() {
    const next = !autoplayEnabled;

    setAutoplayEnabled(next);

    if (!next) {
      cancelCountdown();
    }
  }

  return (
    <section
      aria-labelledby={HEADING_ID}
      data-slot="video-suggestions"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h2 id={HEADING_ID} className="text-base font-semibold tracking-tight text-foreground">
            Up next
          </h2>

          <button
            type="button"
            role="switch"
            aria-checked={autoplayEnabled}
            aria-label="Autoplay next video"
            onClick={handleAutoplayToggle}
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative h-4 w-7 shrink-0 rounded-full transition-colors motion-reduce:transition-none",
                autoplayEnabled ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-3 rounded-full bg-background transition-transform motion-reduce:transition-none",
                  autoplayEnabled ? "translate-x-3.5" : "translate-x-0.5",
                )}
              />
            </span>
            Autoplay
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Suggested by Viewly from a search for this channel.
        </p>
      </div>

      {remainingSeconds === null || nextVideo === null ? null : (
        <div
          data-slot="up-next-countdown"
          className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-surface-elevated p-3"
        >
          <p aria-live="polite" aria-atomic="true" className="text-sm leading-snug text-foreground">
            Up next in {remainingSeconds}s: <span className="font-medium">{nextVideo.title}</span>
          </p>

          <div
            role="progressbar"
            aria-label="Autoplay countdown"
            aria-valuemin={0}
            aria-valuemax={UP_NEXT_COUNTDOWN_SECONDS}
            aria-valuenow={remainingSeconds}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
              style={{
                width: `${(remainingSeconds / UP_NEXT_COUNTDOWN_SECONDS) * 100}%`,
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={skipToNext} className="min-h-11">
              Skip
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancelCountdown}
              className="min-h-11"
            >
              Cancel
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">Press Esc to cancel.</p>
        </div>
      )}

      <ul role="list" className="flex flex-col gap-1">
        {videos.map((video) => {
          const duration = formatDuration(video.durationSeconds);
          const viewCount = formatViewCount(video.viewCount);
          const isNext = nextVideo !== null && video.id === nextVideo.id;
          const isQueued = isVideoQueued(queue, video.id);

          return (
            <li key={video.id} className="flex min-w-0 items-start gap-1">
              <Link
                href={`/watch/${video.id}`}
                aria-label={isNext ? `${video.title} — up next` : video.title}
                data-slot="up-next-row"
                data-next={isNext ? "true" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 gap-2 rounded-lg p-1.5 transition-colors outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                  isNext && "bg-surface-elevated ring-1 ring-primary/50",
                )}
              >
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md bg-muted">
                  <Image
                    src={video.thumbnailUrl}
                    alt=""
                    fill
                    sizes={THUMBNAIL_SIZES}
                    className="object-cover"
                  />
                  {duration === null ? null : (
                    <span className="absolute right-1 bottom-1 rounded bg-background/85 px-1 py-0.5 text-[0.7rem] font-medium text-foreground tabular-nums">
                      <span className="sr-only">Duration </span>
                      {duration}
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
                  {isNext ? (
                    <span className="w-fit rounded bg-primary/15 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary">
                      {remainingSeconds === null ? "Up next" : `Next in ${remainingSeconds}s`}
                    </span>
                  ) : null}

                  <h3 className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
                    {video.title}
                  </h3>
                  {video.channelTitle === "" ? null : (
                    <p className="truncate text-xs text-muted-foreground">{video.channelTitle}</p>
                  )}
                  {viewCount === null ? null : (
                    <p className="text-xs text-muted-foreground">{viewCount}</p>
                  )}
                </div>
              </Link>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={
                  isQueued ? `Remove ${video.title} from queue` : `Add ${video.title} to queue`
                }
                aria-pressed={isQueued}
                title={isQueued ? "Remove from queue" : "Add to queue"}
                onClick={() => (isQueued ? removeVideoFromQueue(video.id) : addVideoToQueue(video))}
                className="min-h-11 min-w-11 shrink-0 text-muted-foreground"
              >
                {isQueued ? <Check aria-hidden="true" /> : <ListPlus aria-hidden="true" />}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
