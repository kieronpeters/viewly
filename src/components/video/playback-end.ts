"use client";

/**
 * The player's ENDED signal, shared with the "Up next" rail.
 *
 * The player owns the IFrame API event; the rail owns the suggestions and the
 * countdown. They are siblings on the watch page, so this small module-level
 * store lets the player announce "this video ended" without either component
 * importing the other (and without a new provider in the page layout).
 *
 * Events carry a monotonic sequence so one consumer processes each ENDED
 * exactly once, even though the store keeps the latest event for consumers
 * that mount a tick late.
 */
export interface PlaybackEndedEvent {
  /** Id of the video whose playback ended. */
  readonly videoId: string;
  /** Strictly increasing event id; never reused. */
  readonly sequence: number;
}

let sequence = 0;
let lastEvent: PlaybackEndedEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Records that `videoId` reached the IFrame API's ENDED state. */
export function publishPlaybackEnded(videoId: string): void {
  sequence += 1;
  lastEvent = { videoId, sequence };
  notify();
}

/** Subscribes to new ENDED events; returns the unsubscribe function. */
export function subscribeToPlaybackEnded(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for `useSyncExternalStore`: the latest event, or `null`. */
export function getPlaybackEndedEvent(): PlaybackEndedEvent | null {
  return lastEvent;
}

/**
 * Server and hydration snapshot.
 *
 * Playback never ends during server rendering, so hydrating with `null` keeps
 * the markup stable; the real value is read once the client subscribes.
 */
export function getServerPlaybackEndedEvent(): PlaybackEndedEvent | null {
  return null;
}

/**
 * Consumes an event a rail has acted on.
 *
 * Passing the event avoids clearing a newer ENDED that arrived between the
 * read and this call. Calling without an argument clears the store outright,
 * which is useful for test isolation.
 */
export function clearPlaybackEndedEvent(event?: PlaybackEndedEvent): void {
  if (event !== undefined && lastEvent?.sequence !== event.sequence) {
    return;
  }

  if (lastEvent === null) {
    return;
  }

  lastEvent = null;
  notify();
}
