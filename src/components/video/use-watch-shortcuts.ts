"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyWatchShortcut,
  resolveWatchShortcut,
  type WatchShortcutPlayer,
} from "./watch-shortcuts";

export interface UseWatchShortcutsOptions {
  /** Returns the live player, or `null` while it loads or after a failure. */
  getPlayer: () => WatchShortcutPlayer | null;
  /** Returns the reserved video box, used as the fullscreen target. */
  getContainer: () => HTMLElement | null;
  /** T77 owns theater mode; omitted until then, so `T` is a no-op. */
  onToggleTheater?: () => void;
}

export interface UseWatchShortcutsResult {
  /** Whether the shortcut panel is open. */
  isHelpOpen: boolean;
  /** Opens the panel (the visible "Keyboard shortcuts" button). */
  openHelp: () => void;
  /** Toggles the panel (`?`). */
  toggleHelp: () => void;
  /** Closes the panel (`Escape` and the close button). */
  closeHelp: () => void;
}

/**
 * Binds the watch-player keyboard shortcuts to the document.
 *
 * One `keydown` listener is installed for the component's lifetime and reads
 * the latest player/container through refs, so creating or destroying the
 * player does not rebind the listener. The hook never calls a player method on
 * mount: the first playback change can only come from a key press.
 *
 * `resolveWatchShortcut` owns the rules (editable targets, modifier chords,
 * repeats, the open panel), so this hook stays a thin dispatcher.
 */
export function useWatchShortcuts({
  getPlayer,
  getContainer,
  onToggleTheater,
}: UseWatchShortcutsOptions): UseWatchShortcutsResult {
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const isHelpOpenRef = useRef(false);
  const getPlayerRef = useRef(getPlayer);
  const getContainerRef = useRef(getContainer);
  const onToggleTheaterRef = useRef(onToggleTheater);

  const openHelp = useCallback(() => setIsHelpOpen(true), []);
  const closeHelp = useCallback(() => setIsHelpOpen(false), []);
  const toggleHelp = useCallback(() => setIsHelpOpen((open) => !open), []);

  useEffect(() => {
    isHelpOpenRef.current = isHelpOpen;
  }, [isHelpOpen]);

  // Keep the latest callbacks without re-registering the document listener.
  useEffect(() => {
    getPlayerRef.current = getPlayer;
    getContainerRef.current = getContainer;
    onToggleTheaterRef.current = onToggleTheater;
  }, [getPlayer, getContainer, onToggleTheater]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveWatchShortcut(event, isHelpOpenRef.current);

      if (action === null) {
        return;
      }

      // The page must not scroll on Space/arrows or trigger browser shortcuts.
      event.preventDefault();

      applyWatchShortcut(action, {
        player: getPlayerRef.current(),
        container: getContainerRef.current(),
        onToggleTheater: onToggleTheaterRef.current,
        toggleHelp,
        closeHelp,
      });
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleHelp, closeHelp]);

  return { isHelpOpen, openHelp, toggleHelp, closeHelp };
}
