"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Local storage key for the watch page's theater-mode preference (T70).
 *
 * Versioned so a future change to the stored shape or meaning can introduce
 * `:v2` without having to interpret values written by an older build. Like the
 * listen-mode and autoplay switches, theater is a viewing habit rather than
 * library data: it stays on this device and never reaches the database or a
 * Server Action.
 */
export const THEATER_PREFERENCE_KEY = "viewly:watch-theater:v1";

/** Listeners notified when a watch surface changes the preference. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads the stored preference.
 *
 * Storage can throw (private mode, blocked storage), so every read falls back
 * to the default: off. Theater changes the page's width allocation, so it must
 * never surprise a viewer just because persistence is unavailable.
 */
export function readTheaterPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(THEATER_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeTheaterPreference(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(THEATER_PREFERENCE_KEY, enabled ? "true" : "false");
  } catch {
    // The toggle still works for this page; it just will not persist.
  }
}

/**
 * Stores the preference and notifies every subscribed surface.
 *
 * Called from the toggle, so the UI and `localStorage` never disagree: even a
 * failed write keeps the in-memory snapshot and the visible pressed state in
 * sync.
 */
export function setTheaterPreference(enabled: boolean): void {
  writeTheaterPreference(enabled);

  for (const listener of listeners) {
    listener();
  }
}

/**
 * Server render and hydration snapshot.
 *
 * The server cannot read `localStorage`, so the first paint is always the
 * standard two-column watch layout. The browser reads the stored value during
 * hydration and `useSyncExternalStore` re-renders if it differs, without a
 * mismatch warning.
 */
const getServerSnapshot = () => false;

/**
 * The watch page's theater-mode preference.
 *
 * Uses `useSyncExternalStore` for the same reason as listen mode: the server
 * renders deterministic markup and every consumer in the page (the grid, the
 * rail and the player's `T` shortcut) shares one value. The setter is stable so
 * controls never re-bind because a render changed their handler.
 */
export function useTheaterPreference(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readTheaterPreference, getServerSnapshot);
  const setEnabled = useCallback((next: boolean) => setTheaterPreference(next), []);

  return [enabled, setEnabled] as const;
}
