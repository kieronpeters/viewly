"use client";

/**
 * The sleep timer's pause request, shared with the player.
 *
 * The queue lives in the watch rail, outside the player component, so it cannot
 * call the YouTube handle directly. This module-level store mirrors
 * `playback-end.ts`: the queue publishes "pause now", the player wrapper
 * subscribes once and calls the handle. No provider, no second player and no
 * direct dependency between the rail and the player component.
 */
const listeners = new Set<() => void>();

/** Asks the mounted player to pause. A no-op when no player is mounted. */
export function publishPauseRequest(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribes to pause requests; returns the unsubscribe function. */
export function subscribeToPauseRequests(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
