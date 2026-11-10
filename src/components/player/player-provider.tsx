"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useListenModePreference } from "@/app/watch/[videoId]/listen-mode-preference";
import { WatchPlayer } from "@/app/watch/[videoId]/watch-player";
import type { VideoSnapshot } from "@/features/library/video-snapshot";
import type { VideoProgress } from "@/features/progress/progress";
import { useIsomorphicLayoutEffect } from "@/lib/use-isomorphic-layout-effect";

/** Everything the watch route hands to the shell player for one video. */
export interface PlayerTrackInput {
  /** Display snapshot the watch page already projected on the server. */
  snapshot: VideoSnapshot;
  /** Server-read local progress, forwarded to the resume prompt. */
  initialProgress?: VideoProgress | null;
}

/** Imperative surface a watch route uses to activate and dock the player. */
export interface PlayerHostController {
  /**
   * Makes this watch route the player's home.
   *
   * Returning cleanup only releases the route: the track keeps playing in the
   * mini player, which is exactly the navigation T75 is about. Calling it again
   * with another video replaces the track without ever unmounting the embed.
   */
  activateWatch(track: PlayerTrackInput): () => void;
  /** Registers (or unregisters) the box the docked player should cover. */
  registerStage(element: HTMLElement | null): void;
  /**
   * Registers the watch page's theater toggle, so the `T` shortcut keeps
   * working now that the player lives above the route's theater provider.
   */
  registerTheaterToggle(toggle: (() => void) | null): () => void;
  /** Releases the current video and destroys the player. */
  dismissMiniPlayer(): void;
}

const PlayerHostContext = createContext<PlayerHostController | null>(null);

/**
 * Height of the docked player, published to the watch route.
 *
 * The docked surface is `position: fixed`: it is visually over the stage slot
 * but takes no space in the page flow, so the watch route reserves the measured
 * height instead. `null` means "not measured yet" and the route falls back to a
 * 16:9 placeholder.
 */
const PlayerStageHeightContext = createContext<number | null>(null);

/**
 * The active shell player, or `null` when this tree has no provider.
 *
 * `null` is a supported state: a watch column rendered on its own (an isolated
 * preview or a unit test) keeps rendering its own player, exactly as before
 * T75. The production shell always provides one.
 */
export function usePlayerHost(): PlayerHostController | null {
  return useContext(PlayerHostContext);
}

/** Measured height of the docked player, or `null` before the first measure. */
export function usePlayerStageHeight(): number | null {
  return useContext(PlayerStageHeightContext);
}

/** Rounded viewport metrics of the box the docked player is clipped to. */
interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Rounded geometry of the watch slot, relative to its scroll container. */
interface DockGeometry {
  /** Visible box of the shell's scroll container (the clip). */
  container: Box;
  /** Slot position and width inside that container. */
  surface: { top: number; left: number; width: number };
}

/** Mini-player classes: desktop bottom-right, above the mobile bottom nav. */
const MINI_CLASSES = [
  "pointer-events-auto absolute",
  "right-3 bottom-[calc(3.5rem_+_env(safe-area-inset-bottom)_+_0.75rem)]",
  "md:right-4 md:bottom-4",
  "w-96 max-w-[calc(100vw_-_1.5rem)]",
].join(" ");

/** Docked inner classes; the geometry itself comes from the measured slot. */
const DOCKED_CLASSES = "pointer-events-auto absolute";

/** Whether two measurements are the same to the pixel, so no render is due. */
function sameGeometry(previous: DockGeometry | null, next: DockGeometry): boolean {
  return (
    previous !== null &&
    previous.container.top === next.container.top &&
    previous.container.left === next.container.left &&
    previous.container.width === next.container.width &&
    previous.container.height === next.container.height &&
    previous.surface.top === next.surface.top &&
    previous.surface.left === next.surface.left &&
    previous.surface.width === next.surface.width
  );
}

/**
 * Owns the one YouTube embed for the whole app (T75).
 *
 * ## Why the player lives here
 *
 * Before T75 the watch route rendered the player, so any navigation away from
 * `/watch/[id]` unmounted the iframe and stopped playback. The embed is now
 * rendered by this provider, which the shell mounts once. Route changes swap
 * the props and the presentation, never the element identity, so exactly one
 * `YT.Player` exists for the session.
 *
 * ## Why a fixed dock instead of a portal
 *
 * Moving a live iframe in the DOM (a changed portal container, a reparenting
 * `appendChild`) recreates its browsing context and stops playback in every
 * engine. A portal from the shell into the watch page's slot would therefore
 * defeat the whole feature the moment the route changes. Instead the provider
 * keeps the player at one stable position in the React tree and makes it
 * *look* like the watch stage: the watch route registers a slot element, this
 * provider measures it and positions a `position: fixed` surface over it on
 * every scroll and resize. Resizing and repositioning an iframe is safe; moving
 * it is not. Off the watch route the same surface becomes the mini player.
 *
 * The surface lives inside a viewport-fixed layer whose `overflow: hidden` box
 * is the shell's scroll container, so scrolling the watch page clips the player
 * exactly as page content would be clipped; it never floats over the header.
 * The layer and the surface keep their identity in both modes, which is what
 * lets the mini player dock and undock without remounting the embed.
 *
 * ## Track lifetime
 *
 * `activateWatch` is called by the watch column in a layout effect, so the
 * player docks before the first paint. Its cleanup only marks the route as
 * gone: the track stays in memory while it plays, so the mini player is a
 * continuation, not a remount. Closing the mini player releases the track and
 * destroys the embed.
 *
 * ## What the route still owns
 *
 * Server data reads (the snapshot, progress, channel) stay in the watch page.
 * The provider only receives the already-projected snapshot, and the resume
 * prompt, listen mode and theater preference remain watch concepts expressed
 * through props.
 */
export function PlayerProvider({ children }: { readonly children: ReactNode }) {
  const [track, setTrack] = useState<{
    snapshot: VideoSnapshot;
    initialProgress: VideoProgress | null;
  } | null>(null);
  const [isWatchActive, setIsWatchActive] = useState(false);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [dockGeometry, setDockGeometry] = useState<DockGeometry | null>(null);
  const [slotHeight, setSlotHeight] = useState<number | null>(null);
  /**
   * Video that has actually started playing.
   *
   * The mini player is a playback surface, not a "last visited" card: without
   * this, opening a video and leaving before pressing play would show a paused
   * mini player for something the viewer never watched.
   */
  const [startedVideoId, setStartedVideoId] = useState<string | null>(null);

  const [listenMode, setListenMode] = useListenModePreference();
  const theaterToggleRef = useRef<(() => void) | null>(null);
  /**
   * Video that has actually started playing, as a ref for the activation
   * cleanup. The cleanup runs from the watch column's effect teardown, where a
   * state read would be stale; a started track must survive the route change so
   * the mini player can continue it, an unstarted one must not keep an invisible
   * embed alive.
   */
  const startedVideoIdRef = useRef<string | null>(null);
  /** Number of mounted watch routes; the cleanup keeps nested renders safe. */
  const activeWatchCountRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const activateWatch = useCallback((input: PlayerTrackInput) => {
    activeWatchCountRef.current += 1;
    const { videoId } = input.snapshot;

    setTrack({
      snapshot: input.snapshot,
      initialProgress: input.initialProgress ?? null,
    });
    setIsWatchActive(true);

    return () => {
      activeWatchCountRef.current = Math.max(activeWatchCountRef.current - 1, 0);

      // Another watch route already claimed the player (a fast transition);
      // its own cleanup decides what happens next.
      if (activeWatchCountRef.current > 0) {
        return;
      }

      setIsWatchActive(false);

      if (startedVideoIdRef.current !== videoId) {
        setTrack((current) =>
          current !== null &&
          current.snapshot.videoId === videoId &&
          startedVideoIdRef.current !== videoId
            ? null
            : current,
        );
      }
    };
  }, []);

  const registerTheaterToggle = useCallback((toggle: (() => void) | null) => {
    theaterToggleRef.current = toggle;

    return () => {
      if (theaterToggleRef.current === toggle) {
        theaterToggleRef.current = null;
      }
    };
  }, []);

  const dismissMiniPlayer = useCallback(() => {
    startedVideoIdRef.current = null;
    setTrack(null);
    setStartedVideoId(null);
  }, []);

  const handleToggleTheater = useCallback(() => {
    theaterToggleRef.current?.();
  }, []);

  const handleToggleListenMode = useCallback(() => {
    setListenMode(!listenMode);
  }, [listenMode, setListenMode]);

  const handlePlaybackStarted = useCallback((videoId: string) => {
    startedVideoIdRef.current = videoId;
    setStartedVideoId(videoId);
  }, []);

  const controller = useMemo<PlayerHostController>(
    () => ({
      activateWatch,
      registerStage: setStage,
      registerTheaterToggle,
      dismissMiniPlayer,
    }),
    [activateWatch, registerTheaterToggle, dismissMiniPlayer],
  );

  // A track nobody started must not keep an invisible player alive after the
  // viewer leaves the watch route; a started one becomes the mini player. This
  // is handled by the activation cleanup above, which runs before the route
  // tree is released.

  /**
   * Follows the watch slot inside the shell's scroll container.
   *
   * `scroll` is captured at the document so an inner scroll container (the
   * shell's `<main>`) is observed too, and the read is coalesced into one frame.
   */
  useIsomorphicLayoutEffect(() => {
    if (stage === null) {
      setDockGeometry(null);
      return;
    }

    // The shell's scroll container is the box the docked player must not draw
    // outside of; without one (an isolated render) the viewport is the clip.
    const scrollRoot = stage.closest<HTMLElement>("[data-scroll-root]");

    let frame = 0;

    const measure = () => {
      frame = 0;
      const slotRect = stage.getBoundingClientRect();
      const containerRect =
        scrollRoot?.getBoundingClientRect() ??
        ({
          top: 0,
          left: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        } satisfies Box);

      const next: DockGeometry = {
        container: {
          top: Math.round(containerRect.top),
          left: Math.round(containerRect.left),
          width: Math.round(containerRect.width),
          height: Math.round(containerRect.height),
        },
        surface: {
          top: Math.round(slotRect.top - containerRect.top),
          left: Math.round(slotRect.left - containerRect.left),
          width: Math.round(slotRect.width),
        },
      };

      setDockGeometry((previous) => (sameGeometry(previous, next) ? previous : next));
    };

    const schedule = () => {
      frame = globalThis.requestAnimationFrame?.(measure) ?? 0;
    };

    measure();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);

    observer?.observe(stage);

    if (scrollRoot !== null) {
      observer?.observe(scrollRoot);
    }

    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      if (frame !== 0) {
        globalThis.cancelAnimationFrame?.(frame);
      }

      observer?.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [stage]);

  /**
   * Publishes the docked height so the watch route can reserve the space the
   * fixed surface covers. Measured rather than derived: the surface contains the
   * 16:9 box, the control row, and in listen mode the compact bar instead.
   */
  useIsomorphicLayoutEffect(() => {
    const surface = surfaceRef.current;

    if (surface === null || stage === null) {
      setSlotHeight(null);
      return;
    }

    const measure = () => {
      const next = surface.getBoundingClientRect().height;

      setSlotHeight((previous) =>
        previous !== null && Math.abs(previous - next) < 1 ? previous : next,
      );
    };

    measure();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);

    observer?.observe(surface);

    return () => observer?.disconnect();
  }, [stage, track?.snapshot.videoId, listenMode]);

  const isDocked = track !== null && isWatchActive;
  const isMini = track !== null && !isWatchActive && startedVideoId === track.snapshot.videoId;
  const surfaceTrack = isDocked || isMini ? track : null;

  return (
    <PlayerHostContext.Provider value={controller}>
      <PlayerStageHeightContext.Provider value={slotHeight}>
        {children}

        {surfaceTrack === null ? null : (
          /*
           * One persistent layer + surface, never re-parented. Docked, the layer
           * is the shell's scroll box with `overflow: hidden`, so the player is
           * clipped exactly like page content when the viewer scrolls past it.
           * Mini, the layer is the viewport and the surface is a corner card.
           * Both states keep the same parent, so the embed never remounts.
           */
          <div
            data-slot="player-layer"
            className="pointer-events-none fixed z-30 overflow-hidden"
            style={
              isMini
                ? { inset: 0 }
                : {
                    top: dockGeometry?.container.top ?? 0,
                    left: dockGeometry?.container.left ?? 0,
                    width: dockGeometry?.container.width ?? 0,
                    height: dockGeometry?.container.height ?? 0,
                  }
            }
          >
            <div
              ref={surfaceRef}
              data-slot="player-surface"
              data-mode={isMini ? "mini" : "docked"}
              className={isMini ? MINI_CLASSES : DOCKED_CLASSES}
              style={
                isMini
                  ? undefined
                  : {
                      top: dockGeometry?.surface.top ?? 0,
                      left: dockGeometry?.surface.left ?? 0,
                      width: dockGeometry?.surface.width ?? 0,
                      visibility: dockGeometry === null ? "hidden" : "visible",
                    }
              }
            >
              <WatchPlayer
                snapshot={surfaceTrack.snapshot}
                initialProgress={surfaceTrack.initialProgress}
                listenMode={listenMode}
                onToggleListenMode={handleToggleListenMode}
                onToggleTheater={handleToggleTheater}
                onPlaybackStarted={handlePlaybackStarted}
                onDismiss={dismissMiniPlayer}
                variant={isMini ? "mini" : "watch"}
              />
            </div>
          </div>
        )}
      </PlayerStageHeightContext.Provider>
    </PlayerHostContext.Provider>
  );
}
