"use client";

import { ArrowDown, ArrowUp, GripVertical, Moon, Shuffle, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/shared/format";
import type { VideoSummary } from "@/shared/types";

import { useAutoplayPreference } from "./autoplay-preference";
import {
  clearPlaybackEndedEvent,
  getPlaybackEndedEvent,
  subscribeToPlaybackEnded,
} from "./playback-end";
import { publishPauseRequest } from "./playback-pause";
import {
  formatSleepTimerRemaining,
  SLEEP_TIMER_DEFAULT_MINUTES,
  SLEEP_TIMER_OPTIONS_MINUTES,
  sleepTimerDeadline,
  sleepTimerRemainingSeconds,
} from "./sleep-timer";
import {
  clearVideoQueue,
  getWatchQueue,
  moveQueuedVideo,
  moveQueuedVideoBy,
  removeVideoFromQueue,
  selectQueueAutoplayVideo,
  shuffleQueuedVideos,
  useWatchQueue,
} from "./watch-queue-store";
import { UP_NEXT_COUNTDOWN_SECONDS } from "./up-next";

export interface WatchQueueProps {
  /** Video currently in the player; never offered as its own next item. */
  currentVideoId: string;
  /** Optional layout classes; the rail owns positioning. */
  className?: string;
}

/** Heading id; a single queue exists on the watch page. */
const HEADING_ID = "watch-queue-heading";

/** Thumbnail is 96px wide at every breakpoint. */
const THUMBNAIL_SIZES = "96px";

/**
 * Local queue rail (T82).
 *
 * A section below "Up next" in the watch workspace rail. It offers the four
 * queue operations — add (from the Up next rows), remove, reorder and shuffle —
 * plus clear, a sleep timer, and autoplay of the first queued video.
 *
 * ## Storage
 *
 * Every row is the stored {@link VideoSummary}; rendering a queued item never
 * calls YouTube. The queue survives reloads through `localStorage`, is capped
 * and validated on read, and is shared between every mounted queue UI through
 * `useWatchQueue` (`watch-queue-store.ts`).
 *
 * ## Autoplay
 *
 * The queue reuses the T69 preference (`autoplay-preference.ts`) instead of
 * adding a second switch. When playback ends and a queued item is waiting, the
 * queue takes ownership of the countdown; "Up next" deliberately stands down
 * while a queued item exists, so only one countdown can ever run. With
 * autoplay off the event is consumed but nothing starts.
 *
 * ## Keyboard and motion
 *
 * Reordering has real Up/Down buttons (44px targets) as well as pointer drag,
 * so the whole queue is usable from the keyboard. Every action is a button, the
 * countdown is cancellable with Escape and the Cancel button, and transitions
 * carry `motion-reduce:transition-none` in addition to the app-wide
 * reduced-motion rule.
 */
export function WatchQueue({ currentVideoId, className }: WatchQueueProps) {
  const queue = useWatchQueue();
  const [autoplayEnabled] = useAutoplayPreference();
  const router = useRouter();
  const selectId = useId();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [autoplayTarget, setAutoplayTarget] = useState<VideoSummary | null>(null);
  const consumedSequenceRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);

  const [sleepMinutes, setSleepMinutes] = useState<number>(SLEEP_TIMER_DEFAULT_MINUTES);
  const [sleepDeadline, setSleepDeadline] = useState<number | null>(null);
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);
  const [sleepMessage, setSleepMessage] = useState<string | null>(null);

  // Subscribe to the player's ENDED signal. The queue only consumes an event
  // when a queued target exists; otherwise the event is left for "Up next".
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

      const target = selectQueueAutoplayVideo(getWatchQueue(), currentVideoId);

      if (target === null) {
        return;
      }

      consumedSequenceRef.current = event.sequence;
      clearPlaybackEndedEvent(event);

      if (!autoplayEnabled) {
        return;
      }

      navigatedRef.current = false;
      setAutoplayTarget(target);
      setRemainingSeconds(UP_NEXT_COUNTDOWN_SECONDS);
    };

    const unsubscribe = subscribeToPlaybackEnded(processEndedEvent);

    // The rail can mount a moment after the player already ended; the store
    // keeps the last event for exactly this case.
    queueMicrotask(processEndedEvent);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [autoplayEnabled, currentVideoId]);

  const isCountingDown = remainingSeconds !== null;

  // Escape cancels from anywhere on the page, matching the visible hint.
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
      setAutoplayTarget(null);
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

  // `0` is the commit point: the countdown has already shown the final second.
  useEffect(() => {
    if (remainingSeconds !== 0 || navigatedRef.current || autoplayTarget === null) {
      return;
    }

    navigatedRef.current = true;
    removeVideoFromQueue(autoplayTarget.id);
    setAutoplayTarget(null);
    setRemainingSeconds(null);
    router.push(`/watch/${autoplayTarget.id}`);
  }, [autoplayTarget, remainingSeconds, router]);

  const cancelAutoplay = useCallback(() => {
    setRemainingSeconds(null);
    setAutoplayTarget(null);
  }, []);

  const skipToNext = useCallback(() => {
    if (autoplayTarget === null || navigatedRef.current) {
      return;
    }

    navigatedRef.current = true;
    removeVideoFromQueue(autoplayTarget.id);
    setRemainingSeconds(null);
    setAutoplayTarget(null);
    router.push(`/watch/${autoplayTarget.id}`);
  }, [autoplayTarget, router]);

  // Both countdowns below start at `null`, and the clock is read only inside
  // effects and event handlers. That keeps the first render (and therefore the
  // prerendered HTML) clock-free: Next rejects a `Date.now()` read while it is
  // prerendering, so the remaining time is derived after mount instead.

  // The deadline drives the countdown; each tick recomputes from the clock so
  // background-tab throttling cannot make the timer drift or run backwards.
  useEffect(() => {
    if (sleepDeadline === null) {
      return;
    }

    let finished = false;

    const tick = () => {
      if (finished) {
        return;
      }

      const remaining = sleepDeadline - Date.now();

      if (remaining <= 0) {
        finished = true;
        setSleepDeadline(null);
        setSleepRemainingMs(null);
        setSleepMessage("Sleep timer paused playback.");
        publishPauseRequest();
        return;
      }

      setSleepRemainingMs(remaining);
    };

    tick();

    const intervalId = window.setInterval(tick, 1000);

    return () => window.clearInterval(intervalId);
  }, [sleepDeadline]);

  const startSleepTimer = useCallback(() => {
    // Event handlers are not part of the prerender, so the clock is read here
    // and passed explicitly to the pure helpers.
    const now = Date.now();
    const deadline = sleepTimerDeadline(sleepMinutes, now);

    setSleepMessage(null);
    setSleepRemainingMs(sleepTimerRemainingSeconds(deadline, now));
    setSleepDeadline(deadline);
  }, [sleepMinutes]);

  const cancelSleepTimer = useCallback(() => {
    setSleepDeadline(null);
    setSleepRemainingMs(null);
    setSleepMessage("Sleep timer cancelled.");
  }, []);

  function handleDragStart(event: DragEvent<HTMLSpanElement>, index: number) {
    setDraggedIndex(index);
    event.dataTransfer.effectAllowed = "move";

    try {
      event.dataTransfer.setData("text/plain", String(index));
    } catch {
      // Some browsers expose a read-only dataTransfer during synthetic drags.
    }
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, index: number) {
    if (draggedIndex === null) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (dropIndex !== index) {
      setDropIndex(index);
    }
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault();

    if (draggedIndex !== null) {
      moveQueuedVideo(draggedIndex, index);
    }

    setDraggedIndex(null);
    setDropIndex(null);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDropIndex(null);
  }

  const sleepCountdown =
    sleepRemainingMs === null
      ? null
      : formatSleepTimerRemaining(Math.ceil(sleepRemainingMs / 1000));

  return (
    <section
      aria-labelledby={HEADING_ID}
      data-slot="watch-queue"
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={HEADING_ID} className="text-base font-semibold tracking-tight text-foreground">
            Queue
            {queue.length === 0 ? null : (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({queue.length})
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">Saved on this device.</p>
        </div>

        <div role="group" aria-label="Queue actions" className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Shuffle queue"
            title="Shuffle queue"
            disabled={queue.length < 2}
            onClick={() => shuffleQueuedVideos()}
            className="min-h-11 min-w-11 text-muted-foreground"
          >
            <Shuffle aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear queue"
            title="Clear queue"
            disabled={queue.length === 0}
            onClick={() => clearVideoQueue()}
            className="min-h-11 min-w-11 text-muted-foreground"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      {queue.length === 0 ? (
        <div
          data-slot="watch-queue-empty"
          className="rounded-lg border border-dashed border-border p-3"
        >
          <p className="text-sm font-medium text-foreground">Your queue is empty</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add videos from Up next to play them here after this one.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {autoplayEnabled
              ? "Autoplay is on. The first queued video plays when this one ends."
              : "Autoplay is off. Turn it on in Up next to play the queue automatically."}
          </p>

          <ul aria-label="Queued videos" className="flex flex-col gap-1">
            {queue.map((video, index) => {
              const duration = formatDuration(video.durationSeconds);
              const isDragging = draggedIndex === index;
              const isDropTarget = dropIndex === index && draggedIndex !== null && !isDragging;

              return (
                <li
                  key={video.id}
                  data-slot="watch-queue-row"
                  data-dragging={isDragging ? "true" : undefined}
                  data-drop-target={isDropTarget ? "true" : undefined}
                  onDragOver={(event) => handleDragOver(event, index)}
                  onDrop={(event) => handleDrop(event, index)}
                  className={cn(
                    "flex min-w-0 flex-col gap-1 rounded-lg border border-transparent bg-surface-elevated/40 p-1.5 transition-colors motion-reduce:transition-none",
                    isDragging && "opacity-60",
                    isDropTarget && "border-primary/60 bg-surface-elevated",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-1">
                    <span
                      draggable
                      aria-hidden="true"
                      title="Drag to reorder"
                      onDragStart={(event) => handleDragStart(event, index)}
                      onDragEnd={handleDragEnd}
                      className="flex min-h-11 min-w-11 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" />
                    </span>

                    <Link
                      href={`/watch/${video.id}`}
                      aria-label={`Play ${video.title}`}
                      onClick={() => removeVideoFromQueue(video.id)}
                      className="flex min-w-0 flex-1 gap-2 rounded-md p-1 transition-colors outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                    >
                      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded bg-muted">
                        <Image
                          src={video.thumbnailUrl}
                          alt=""
                          fill
                          sizes={THUMBNAIL_SIZES}
                          className="object-cover"
                        />
                        {duration === null ? null : (
                          <span className="absolute right-0.5 bottom-0.5 rounded bg-background/85 px-1 py-0.5 text-[0.65rem] font-medium text-foreground tabular-nums">
                            <span className="sr-only">Duration </span>
                            {duration}
                          </span>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[0.7rem] font-medium text-muted-foreground tabular-nums">
                          {index + 1}
                        </span>
                        <h3 className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
                          {video.title}
                        </h3>
                        {video.channelTitle === "" ? null : (
                          <p className="truncate text-xs text-muted-foreground">
                            {video.channelTitle}
                          </p>
                        )}
                      </div>
                    </Link>
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${video.title} up`}
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => moveQueuedVideoBy(index, -1)}
                      className="min-h-11 min-w-11 text-muted-foreground"
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${video.title} down`}
                      title="Move down"
                      disabled={index === queue.length - 1}
                      onClick={() => moveQueuedVideoBy(index, 1)}
                      className="min-h-11 min-w-11 text-muted-foreground"
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${video.title} from queue`}
                      title="Remove from queue"
                      onClick={() => removeVideoFromQueue(video.id)}
                      className="min-h-11 min-w-11 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {remainingSeconds === null || autoplayTarget === null ? null : (
        <div
          data-slot="queue-autoplay-countdown"
          className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-surface-elevated p-3"
        >
          <p aria-live="polite" aria-atomic="true" className="text-sm leading-snug text-foreground">
            Playing next in {remainingSeconds}s:{" "}
            <span className="font-medium">{autoplayTarget.title}</span>
          </p>

          <div
            role="progressbar"
            aria-label="Queue autoplay countdown"
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
              onClick={cancelAutoplay}
              className="min-h-11"
            >
              Cancel
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">Press Esc to cancel.</p>
        </div>
      )}

      <div data-slot="sleep-timer" className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          <Moon aria-hidden="true" className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Sleep timer</h3>
        </div>

        {sleepDeadline === null ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={selectId} className="text-xs text-muted-foreground">
                Pause after
              </label>
              <select
                id={selectId}
                value={sleepMinutes}
                onChange={(event) => setSleepMinutes(Number(event.target.value))}
                className="min-h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {SLEEP_TIMER_OPTIONS_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </div>

            <Button type="button" onClick={startSleepTimer} className="min-h-11">
              Start sleep timer
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p role="timer" className="text-sm text-foreground tabular-nums">
              Pausing in {sleepCountdown}
            </p>
            <Button type="button" variant="outline" onClick={cancelSleepTimer} className="min-h-11">
              Cancel sleep timer
            </Button>
          </div>
        )}

        {sleepMessage === null ? null : (
          <p role="status" className="text-xs text-muted-foreground">
            {sleepMessage}
          </p>
        )}
      </div>
    </section>
  );
}
