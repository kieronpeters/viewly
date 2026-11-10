"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Local storage key for the watch page's "listen mode" preference (T86).
 *
 * Like the autoplay switch, this is a playback habit rather than library data,
 * so it never reaches the database or a Server Action. It is device-local and
 * applies to every watch page until the viewer turns it off.
 */
export const LISTEN_MODE_PREFERENCE_KEY = "viewly:listen-mode";

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
 * Storage can throw (private mode, blocked third-party storage), so every read
 * falls back to the default: off. Listen mode changes the layout substantially,
 * so it must never surprise a viewer because persistence is unavailable.
 */
export function readListenModePreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(LISTEN_MODE_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeListenModePreference(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LISTEN_MODE_PREFERENCE_KEY, enabled ? "true" : "false");
  } catch {
    // The toggle still works for this page; it just will not persist.
  }
}

/**
 * Stores the preference and notifies every subscribed surface.
 *
 * Called from the toggle, so the UI and `localStorage` never disagree: even a
 * failed write keeps the in-memory snapshot and the visible switch in sync.
 */
export function setListenModePreference(enabled: boolean): void {
  writeListenModePreference(enabled);

  for (const listener of listeners) {
    listener();
  }
}

/** Server render and hydration snapshot: no storage, so the default is off. */
const getServerSnapshot = () => false;

/**
 * The watch page's listen-mode preference.
 *
 * `useSyncExternalStore` lets the server render the normal video layout while
 * the browser reads the real value after hydration without a mismatch. The
 * setter is stable so the switch's click handler never depends on the render.
 */
export function useListenModePreference(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readListenModePreference, getServerSnapshot);
  const setEnabled = useCallback((next: boolean) => setListenModePreference(next), []);

  return [enabled, setEnabled] as const;
}
