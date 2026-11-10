"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { applyWatchShortcut } from "./watch-shortcuts";

/**
 * Shared shape of the controls.
 *
 * `min-h-11`/`min-w-11` keep the target at least 44px on both axes even though
 * the button variant itself is compact; the visible focus ring comes from
 * `Button` (`focus-visible:ring-3`), so keyboard users see where they are.
 */
const CONTROL_CLASS =
  "min-h-11 min-w-11 gap-1.5 px-3 text-sm text-muted-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Placeholder callbacks for the actions this module never dispatches. */
const ignore = () => {};

/**
 * The document that owns `element`, or the page document before mount.
 *
 * Reading through `ownerDocument` means the player still works when it is
 * rendered into another document (for example a test harness or a portal).
 */
function getOwnerDocument(element: HTMLElement | null): Document | null {
  if (element !== null) {
    return element.ownerDocument;
  }

  return typeof document === "undefined" ? null : document;
}

/** Tracks whether the reserved box is the current fullscreen element. */
function useFullscreen(getContainer: () => HTMLElement | null): {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
} {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const doc = getOwnerDocument(getContainer());

    if (doc === null) {
      return;
    }

    // Entering by any route (our button, `F`, the browser menu, the iframe's
    // own control) emits the same event, so the button state stays truthful.
    const sync = () => setIsFullscreen(doc.fullscreenElement === getContainer());

    sync();
    doc.addEventListener("fullscreenchange", sync);

    return () => doc.removeEventListener("fullscreenchange", sync);
  }, [getContainer]);

  const toggleFullscreen = useCallback(() => {
    const container = getContainer();

    if (container === null) {
      return;
    }

    // Reuse the T67 shortcut path rather than re-implementing the API call:
    // `applyWatchShortcut` already toggles enter/exit and swallows a rejected
    // request. `player`, `toggleHelp` and `closeHelp` are unused for this action.
    applyWatchShortcut(
      { type: "fullscreen" },
      { player: null, container, toggleHelp: ignore, closeHelp: ignore },
    );
  }, [getContainer]);

  return { isFullscreen, toggleFullscreen };
}

export interface PlayerControlsProps {
  /** Returns the reserved 16:9 box, which is the fullscreen target. */
  getContainer: () => HTMLElement | null;
  /** Optional wrapper classes; spacing stays with the parent layout. */
  className?: string;
}

/**
 * Fullscreen control for the watch player.
 *
 * This is a toggle button: the accessible name is stable and `aria-pressed`
 * reports the state, so a screen reader announces "Fullscreen, pressed" rather
 * than a label that changes under the cursor. The icon switches between the
 * enter and exit glyphs, and `title` gives the same hint to pointer users.
 *
 * The reserved box is the target, not the iframe, so entering and leaving
 * leaves the React-owned layout intact. The toggle is the same function the `F`
 * shortcut calls, and `fullscreenchange` drives the visible state, so the
 * button is correct whether fullscreen was entered from here, from the
 * keyboard, or from the browser's own UI.
 *
 * The control sits outside the box, so it is not visible while the box fills
 * the screen (it must never cover the embed's own controls or branding);
 * `Escape`, `F` and the browser's fullscreen UI all exit.
 */
export function PlayerControls({ getContainer, className }: PlayerControlsProps) {
  const { isFullscreen, toggleFullscreen } = useFullscreen(getContainer);

  return (
    <div data-slot="player-controls" className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Fullscreen"
        aria-pressed={isFullscreen}
        aria-keyshortcuts="f"
        title={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
        onClick={toggleFullscreen}
        className={CONTROL_CLASS}
      >
        {isFullscreen ? (
          <Minimize2 aria-hidden="true" className="size-4" />
        ) : (
          <Maximize2 aria-hidden="true" className="size-4" />
        )}
        Fullscreen
      </Button>
    </div>
  );
}
