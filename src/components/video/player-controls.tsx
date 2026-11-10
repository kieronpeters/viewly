"use client";

import { Maximize2, Minimize2, PictureInPicture2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { applyWatchShortcut } from "./watch-shortcuts";

/**
 * Shared shape of the two controls.
 *
 * `min-h-11`/`min-w-11` keep the target at least 44px on both axes even though
 * the button variant itself is compact; the visible focus ring comes from
 * `Button` (`focus-visible:ring-3`), so keyboard users see where they are.
 */
const CONTROL_CLASS =
  "min-h-11 min-w-11 gap-1.5 px-3 text-sm text-muted-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Placeholder callbacks for the actions this module never dispatches. */
const ignore = () => {};

/** Server and pre-hydration snapshot: without a document there is no PiP. */
const NO_SUPPORT = () => false;

/**
 * Stable no-op subscription.
 *
 * The capability is fixed by the browser and the rendered surface; nothing the
 * page can observe while mounted changes it, so there is nothing to subscribe
 * to. Returning a stable function keeps `useSyncExternalStore` from resubscribing
 * on every render.
 */
const subscribeToNothing = () => () => {};

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

/**
 * The media element the browser can move into its own picture-in-picture
 * window, if the current surface exposes one.
 *
 * The official YouTube embed is a cross-origin iframe, so nothing inside it is
 * reachable from this document. The lookup therefore returns `null` for the
 * shipped player, and the control hides itself instead of offering a button
 * that cannot work.
 */
function findMediaElement(container: HTMLElement | null): HTMLVideoElement | null {
  return container?.querySelector<HTMLVideoElement>("video") ?? null;
}

/** Whether `doc` can put `media` into a picture-in-picture window. */
function canUsePictureInPicture(doc: Document | null, media: HTMLVideoElement | null): boolean {
  if (doc === null || media === null || doc.pictureInPictureEnabled !== true) {
    return false;
  }

  return typeof media.requestPictureInPicture === "function";
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

/** Tracks picture-in-picture support and whether the media element is in PiP. */
function usePictureInPicture(getContainer: () => HTMLElement | null): {
  isSupported: boolean;
  isActive: boolean;
  togglePictureInPicture: () => void;
} {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [activeElement, setActiveElement] = useState<HTMLVideoElement | null>(null);

  // Capability depends on the document and the rendered surface, so it is read
  // as an external store: the server snapshot is "no", and the client snapshot
  // is evaluated after hydration without an effect-driven re-render.
  const getSnapshot = useCallback(() => {
    const media = findMediaElement(getContainer());

    return canUsePictureInPicture(getOwnerDocument(media), media);
  }, [getContainer]);

  const isSupported = useSyncExternalStore(subscribeToNothing, getSnapshot, NO_SUPPORT);

  useEffect(() => {
    const media = findMediaElement(getContainer());

    mediaRef.current = media;

    if (media === null) {
      return;
    }

    const onEnter = () => setActiveElement(media);
    const onLeave = () => setActiveElement((current) => (current === media ? null : current));

    media.addEventListener("enterpictureinpicture", onEnter);
    media.addEventListener("leavepictureinpicture", onLeave);

    return () => {
      media.removeEventListener("enterpictureinpicture", onEnter);
      media.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [getContainer]);

  const togglePictureInPicture = useCallback(() => {
    const media = mediaRef.current;

    if (media === null) {
      return;
    }

    const doc = media.ownerDocument;

    if (doc.pictureInPictureElement === media) {
      const exit = doc.exitPictureInPicture?.();

      // The promise is optional in older browsers; a rejected exit (the window
      // was closed by the viewer) must not surface as an unhandled rejection.
      if (exit !== undefined) {
        void exit.catch(ignore);
      }

      return;
    }

    try {
      const request = media.requestPictureInPicture?.();

      if (request !== undefined) {
        void request.catch(ignore);
      }
    } catch {
      // A synchronous throw (insecure context, permissions policy, an embed
      // that forbids PiP) leaves the button unpressed instead of crashing.
    }
  }, []);

  return { isSupported, isActive: activeElement !== null, togglePictureInPicture };
}

export interface PlayerControlsProps {
  /**
   * Returns the reserved 16:9 box.
   *
   * It is the fullscreen target, and the element searched for a media element
   * the browser can put in a picture-in-picture window.
   */
  getContainer: () => HTMLElement | null;
  /** Optional wrapper classes; spacing stays with the parent layout. */
  className?: string;
}

/**
 * Fullscreen and picture-in-picture controls for the watch player.
 *
 * Both are toggle buttons: the accessible name is stable and `aria-pressed`
 * reports the state, so a screen reader announces "Fullscreen, pressed" rather
 * than a label that changes under the cursor. The icons switch between the
 * enter and exit glyphs, and `title` gives the same hint to pointer users.
 *
 * ## Fullscreen
 *
 * The reserved box is the target, not the iframe, so entering and leaving
 * leaves the React-owned layout intact. The toggle is the same function the
 * `F` shortcut calls, and `fullscreenchange` drives the visible state, so the
 * button is correct whether fullscreen was entered from here, from the
 * keyboard, or from the browser's own UI.
 *
 * The control sits outside the box, so it is not visible while the box fills
 * the screen (it must never cover the embed's own controls or branding);
 * `Escape`, `F` and the browser's fullscreen UI all exit.
 *
 * ## Picture-in-picture
 *
 * Support is checked on mount and the control is hidden when the browser has
 * no PiP API or the surface has no media element to hand over. A rejected
 * request is swallowed: a permission or policy failure never crashes the page.
 */
export function PlayerControls({ getContainer, className }: PlayerControlsProps) {
  const { isFullscreen, toggleFullscreen } = useFullscreen(getContainer);
  const { isSupported, isActive, togglePictureInPicture } = usePictureInPicture(getContainer);

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

      {isSupported ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Picture in picture"
          aria-pressed={isActive}
          title={isActive ? "Exit picture in picture" : "Picture in picture"}
          onClick={togglePictureInPicture}
          className={CONTROL_CLASS}
        >
          <PictureInPicture2 aria-hidden="true" className="size-4" />
          Picture in picture
        </Button>
      ) : null}
    </div>
  );
}
