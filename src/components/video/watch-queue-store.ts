"use client";

import { useSyncExternalStore } from "react";

import type { VideoSummary } from "@/shared/types";

/**
 * Local watch queue (T82).
 *
 * The queue is a playback habit, like the autoplay preference, so it lives in
 * `localStorage` rather than SQLite: it is device-local, needs no account, and
 * never leaves the browser. Every item is stored as its normalized
 * {@link VideoSummary}, so rendering or playing a queued video never triggers
 * another YouTube request.
 *
 * The module is deliberately split in two layers:
 *
 * 1. Pure list operations ({@link addQueueItem}, {@link removeQueueItem},
 *    {@link moveQueueItem}, {@link shuffleQueue}) that never touch storage and
 *    are easy to test.
 * 2. A tiny external store for React (`useWatchQueue`) that reads and writes
 *    the versioned envelope, keeps a stable snapshot reference, and notifies
 *    every mounted queue rail.
 */

/** Storage key for the versioned queue envelope. */
export const WATCH_QUEUE_STORAGE_KEY = "viewly:watch-queue";

/** Envelope version; bumped only when the on-disk shape changes. */
export const WATCH_QUEUE_VERSION = 1;

/** Hard cap so a tampered or very old queue cannot grow without bound. */
export const WATCH_QUEUE_LIMIT = 50;

/** A YouTube video id as it appears in `videos.list` / `search.list`. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Thumbnail hosts the Next image loader is configured for.
 *
 * A stored queue is untrusted input after a manual edit or an old version, so
 * only URLs the image component can actually render are accepted.
 */
const THUMBNAIL_HOSTS = new Set(["i.ytimg.com", "img.youtube.com", "yt3.ggpht.com"]);

/** Shared frozen empty list; also the server/hydration snapshot. */
export const EMPTY_WATCH_QUEUE: readonly VideoSummary[] = Object.freeze([]);

interface StoredQueueEnvelope {
  version: number;
  items: unknown[];
}

/** True when `value` is a plain object, never an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a trimmed string, returning `""` for anything else. */
function readString(value: unknown, maxLength = 500): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Reads a non-negative finite number, or `null`. */
function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** True for an absolute https URL on one of the configured thumbnail hosts. */
function isRenderableThumbnail(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && THUMBNAIL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Validates and projects one stored item.
 *
 * Returns `null` for anything that could not be rendered safely: a malformed
 * id, an empty title, or a thumbnail on a host the image loader rejects. Only
 * the fields the queue actually uses are kept, so an oversized stored payload
 * cannot smuggle extra data into React.
 */
export function sanitizeQueueItem(value: unknown): VideoSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id, 32);

  if (!VIDEO_ID_PATTERN.test(id)) {
    return null;
  }

  const title = readString(value.title);

  if (title === "") {
    return null;
  }

  const thumbnailUrl = readString(value.thumbnailUrl, 2_048);

  if (!isRenderableThumbnail(thumbnailUrl)) {
    return null;
  }

  return {
    id,
    title,
    channelId: readString(value.channelId, 64),
    channelTitle: readString(value.channelTitle, 200),
    thumbnailUrl,
    publishedAt: readString(value.publishedAt, 64),
    durationSeconds: readCount(value.durationSeconds),
    viewCount: readCount(value.viewCount),
  };
}

/** Projects a trusted summary onto exactly the fields the queue stores. */
function queueItemFromSummary(video: VideoSummary): VideoSummary {
  return {
    id: video.id,
    title: video.title,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
    viewCount: video.viewCount,
  };
}

/**
 * Appends a video to the queue.
 *
 * Duplicates are ignored rather than moved: pressing "Add to queue" twice must
 * not reorder or multiply an item. The oldest item falls off at the cap.
 */
export function addQueueItem(
  queue: readonly VideoSummary[],
  video: VideoSummary,
): readonly VideoSummary[] {
  const item = sanitizeQueueItem(video);

  if (item === null || queue.some((candidate) => candidate.id === item.id)) {
    return queue;
  }

  return [...queue, item].slice(-WATCH_QUEUE_LIMIT);
}

/** Removes one video by id; an unknown id returns the same list. */
export function removeQueueItem(
  queue: readonly VideoSummary[],
  videoId: string,
): readonly VideoSummary[] {
  const next = queue.filter((video) => video.id !== videoId);

  return next.length === queue.length ? queue : next;
}

/**
 * Moves the item at `fromIndex` to `toIndex`.
 *
 * Both indexes are clamped into range, and a no-op (same index, an empty queue
 * or a non-integer index) returns the original list so callers can compare
 * references.
 */
export function moveQueueItem(
  queue: readonly VideoSummary[],
  fromIndex: number,
  toIndex: number,
): readonly VideoSummary[] {
  if (queue.length < 2 || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
    return queue;
  }

  const from = Math.min(Math.max(fromIndex, 0), queue.length - 1);
  const to = Math.min(Math.max(toIndex, 0), queue.length - 1);

  if (from === to) {
    return queue;
  }

  const next = queue.slice();
  const [item] = next.splice(from, 1);

  if (item === undefined) {
    return queue;
  }

  next.splice(to, 0, item);

  return next;
}

/** Moves one queue item by `delta` places (used by the Up/Down controls). */
export function moveQueueItemBy(
  queue: readonly VideoSummary[],
  index: number,
  delta: number,
): readonly VideoSummary[] {
  if (!Number.isInteger(index) || !Number.isInteger(delta)) {
    return queue;
  }

  return moveQueueItem(queue, index, index + delta);
}

/**
 * Fisher-Yates shuffle.
 *
 * `random` is injectable so tests can assert the exact permutation and so a
 * future caller can use a seeded generator. With fewer than two items the same
 * list is returned unchanged.
 */
export function shuffleQueue(
  queue: readonly VideoSummary[],
  random: () => number = Math.random,
): readonly VideoSummary[] {
  if (queue.length < 2) {
    return queue;
  }

  const next = queue.slice();

  for (let index = next.length - 1; index > 0; index -= 1) {
    const sample = random();
    const roll = Number.isFinite(sample) ? sample : 0;
    const swapIndex = Math.min(index, Math.max(0, Math.floor(roll * (index + 1))));
    const current = next[index];
    const other = next[swapIndex];

    if (current === undefined || other === undefined) {
      continue;
    }

    next[index] = other;
    next[swapIndex] = current;
  }

  return next;
}

/** True when `videoId` already appears in the queue. */
export function isVideoQueued(queue: readonly VideoSummary[], videoId: string): boolean {
  return queue.some((video) => video.id === videoId);
}

/**
 * First queue item that is not the video currently playing.
 *
 * The watch page may enqueue the current video, and a stale stored queue may
 * still contain it. Skipping it keeps autoplay from reloading the same video.
 */
export function selectQueueAutoplayVideo(
  queue: readonly VideoSummary[],
  currentVideoId: string,
): VideoSummary | null {
  return queue.find((video) => video.id !== currentVideoId) ?? null;
}

/** Parses the stored envelope (or a legacy bare array) into a safe queue. */
export function parseWatchQueue(raw: string | null): readonly VideoSummary[] {
  if (raw === null) {
    return EMPTY_WATCH_QUEUE;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_WATCH_QUEUE;
  }

  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : null;

  if (items === null) {
    return EMPTY_WATCH_QUEUE;
  }

  const seen = new Set<string>();
  const queue: VideoSummary[] = [];

  for (const value of items) {
    const video = sanitizeQueueItem(value);

    if (video === null || seen.has(video.id)) {
      continue;
    }

    seen.add(video.id);
    queue.push(video);

    if (queue.length >= WATCH_QUEUE_LIMIT) {
      break;
    }
  }

  return queue.length === 0 ? EMPTY_WATCH_QUEUE : queue;
}

/** Serializes the queue as the versioned envelope written to storage. */
export function serializeWatchQueue(queue: readonly VideoSummary[]): string {
  const envelope: StoredQueueEnvelope = {
    version: WATCH_QUEUE_VERSION,
    items: queue.slice(0, WATCH_QUEUE_LIMIT).map(queueItemFromSummary),
  };

  return JSON.stringify(envelope);
}

/** Listeners notified when the queue changes in this tab or another tab. */
const listeners = new Set<() => void>();

/** Raw storage value the cached list was parsed from. */
let cachedRaw: string | null | undefined;
/** Stable snapshot returned to `useSyncExternalStore`. */
let cachedQueue: readonly VideoSummary[] = EMPTY_WATCH_QUEUE;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Reads the current queue.
 *
 * Storage is read on every snapshot request but the parsed list is cached
 * until the raw string changes, so `useSyncExternalStore` always gets the same
 * reference between changes (including after `localStorage.clear()` in tests
 * or another tab writing the key).
 */
function readSnapshot(): readonly VideoSummary[] {
  if (typeof window === "undefined") {
    return EMPTY_WATCH_QUEUE;
  }

  let raw: string | null;

  try {
    raw = window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY);
  } catch {
    return cachedQueue;
  }

  if (raw === cachedRaw) {
    return cachedQueue;
  }

  cachedRaw = raw;
  cachedQueue = parseWatchQueue(raw);

  return cachedQueue;
}

/** Server and pre-hydration snapshot: no storage is read during SSR. */
function getServerSnapshot(): readonly VideoSummary[] {
  return EMPTY_WATCH_QUEUE;
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== WATCH_QUEUE_STORAGE_KEY) {
    return;
  }

  cachedRaw = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

/** Persists `next`, keeps the cached snapshot in step and notifies every rail. */
function commit(next: readonly VideoSummary[]): void {
  cachedQueue = next;

  if (typeof window === "undefined") {
    notify();
    return;
  }

  try {
    const serialized = serializeWatchQueue(next);

    window.localStorage.setItem(WATCH_QUEUE_STORAGE_KEY, serialized);
    cachedRaw = serialized;
  } catch {
    // Storage can be unavailable (private mode, quota, policy). Keep the
    // in-memory list so the queue still works for this page.
    try {
      cachedRaw = window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY);
    } catch {
      cachedRaw = undefined;
    }
  }

  notify();
}

/** Current queue for non-React callers (the player's ENDED handler). */
export function getWatchQueue(): readonly VideoSummary[] {
  return readSnapshot();
}

/** Appends a video and persists the result. */
export function addVideoToQueue(video: VideoSummary): void {
  commit(addQueueItem(readSnapshot(), video));
}

/** Removes a video by id and persists the result. */
export function removeVideoFromQueue(videoId: string): void {
  commit(removeQueueItem(readSnapshot(), videoId));
}

/** Moves the item at `fromIndex` to `toIndex` and persists the result. */
export function moveQueuedVideo(fromIndex: number, toIndex: number): void {
  commit(moveQueueItem(readSnapshot(), fromIndex, toIndex));
}

/** Moves one item by `delta` places and persists the result. */
export function moveQueuedVideoBy(index: number, delta: number): void {
  commit(moveQueueItemBy(readSnapshot(), index, delta));
}

/** Shuffles the queue and persists the result. */
export function shuffleQueuedVideos(random?: () => number): void {
  commit(shuffleQueue(readSnapshot(), random));
}

/** Empties the queue and persists the empty list. */
export function clearVideoQueue(): void {
  commit(EMPTY_WATCH_QUEUE);
}

/**
 * Drops the in-memory cache without touching storage.
 *
 * Storage changes are already detected by {@link readSnapshot}; this exists for
 * tests and for a caller that deliberately wants a re-read.
 */
export function resetWatchQueueCache(): void {
  cachedRaw = undefined;
  cachedQueue = EMPTY_WATCH_QUEUE;
  notify();
}

/**
 * The local queue, kept in sync across every mounted queue UI.
 *
 * `useSyncExternalStore` renders {@link EMPTY_WATCH_QUEUE} on the server and
 * during hydration, then swaps in the stored queue after mount. That keeps the
 * server markup deterministic without a loading flicker or a hydration warning.
 */
export function useWatchQueue(): readonly VideoSummary[] {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
}
