"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Local storage key for the watch page's "autoplay next" preference.
 *
 * The preference is intentionally device-local: it is a playback habit, not
 * library data, so it never reaches the database or a Server Action.
 */
export const AUTOPLAY_PREFERENCE_KEY = "viewly:autoplay-next";

/** Listeners notified when any rail on this page changes the preference. */
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
 * Storage can throw (private mode, blocked third-party storage), so every read
 * falls back to the default: off. Autoplay is opt-in and must never surprise a
 * viewer because persistence is unavailable.
 */
export function readAutoplayPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(AUTOPLAY_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeAutoplayPreference(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(AUTOPLAY_PREFERENCE_KEY, enabled ? "true" : "false");
  } catch {
    // The toggle still works for this page; it just will not persist.
  }
}

/**
 * Stores the preference and notifies every subscribed rail.
 *
 * Called from the toggle, so the UI and `localStorage` never disagree: even a
 * failed write keeps the in-memory snapshot and the visible switch in sync.
 */
export function setAutoplayPreference(enabled: boolean): void {
  writeAutoplayPreference(enabled);

  for (const listener of listeners) {
    listener();
  }
}

/** Server render and hydration snapshot: no storage, so the default is off. */
const getServerSnapshot = () => false;

/**
 * The rail's local preference.
 *
 * `useSyncExternalStore` lets the server render the safe default while the
 * browser reads the real value after hydration without a mismatch. The setter
 * is stable so the switch's click handler never depends on the render.
 */
export function useAutoplayPreference(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readAutoplayPreference, getServerSnapshot);
  const setEnabled = useCallback((next: boolean) => setAutoplayPreference(next), []);

  return [enabled, setEnabled] as const;
}
