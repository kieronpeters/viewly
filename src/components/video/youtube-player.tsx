"use client";

import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PlayerControls } from "./player-controls";
import { useWatchShortcuts } from "./use-watch-shortcuts";
import { WatchShortcutsOverlay } from "./watch-shortcuts-overlay";
import type { WatchShortcutPlayer } from "./watch-shortcuts";
import {
  loadYoutubeIframeApi,
  YOUTUBE_PLAYER_STATE,
  type YoutubeIframePlayer,
} from "./youtube-iframe-api";

/** Embed host: no advertising cookies until the viewer starts playback. */
const EMBED_HOST = "https://www.youtube-nocookie.com";

/**
 * Player parameters.
 *
 * `rel=0` keeps the end screen on the same channel instead of pulling in
 * unrelated recommendations. `autoplay=0` means a page load never starts
 * playback (and therefore never records a view).
 */
const PLAYER_VARS = { rel: 0, autoplay: 0 } as const;

/** Suffix that tells assistive technology which iframe is the player. */
const IFRAME_TITLE_SUFFIX = " — YouTube video player";

/**
 * How far outside the viewport the player may be before the API is requested.
 * The box is already reserved, so loading a little early costs no layout shift.
 */
const OBSERVER_ROOT_MARGIN = "200px";

/**
 * Imperative playback controls exposed once the API has created the player.
 *
 * The watch page uses these for progress reporting, the resume prompt and the
 * listen-mode bar (T86). The methods are safe to call at any time: an
 * unavailable API or a destroyed player reads as `0` and every command is a
 * no-op, so a blocked embed never throws into React.
 */
export interface YoutubePlayerHandle {
  /** Current position in whole-ish seconds; `0` when unavailable. */
  getCurrentTime(): number;
  /** Total duration in seconds; `0` until the API knows it. */
  getDuration(): number;
  /** Seeks to `seconds`, clamped to a non-negative value. */
  seekTo(seconds: number): void;
  /** Starts playback through the official player. */
  play(): void;
  /** Pauses playback through the official player. */
  pause(): void;
  /** Current {@link YOUTUBE_PLAYER_STATE}, or `UNSTARTED` when unavailable. */
  getPlaybackState(): number;
  /** Current volume (0–100); `100` when the API is unavailable. */
  getVolume(): number;
  /** Sets volume (0–100); ignored when the API is unavailable. */
  setVolume(volume: number): void;
  /** Whether the official player is muted. */
  isMuted(): boolean;
  /** Mutes or unmutes the official player. */
  setMuted(muted: boolean): void;
}

export interface YoutubePlayerProps {
  /** Normalized 11-character YouTube id; never a raw route segment. */
  videoId: string;
  /** Video title, used verbatim in the iframe's accessible name. */
  title: string;
  /** Optional wrapper classes; page layout stays with the parent. */
  className?: string;
  /**
   * Called once per mount, the first time the player reports `PLAYING`.
   *
   * Never called for the initial load, a pause, buffering or a seek: only a
   * state change whose data is exactly `PLAYING` starts the callback, and a
   * per-effect flag keeps later `PLAYING` states (for example after seeking)
   * from firing it again. The parent owns what the callback does; the player
   * never records anything itself.
   */
  onPlaybackStart?: () => void;
  /**
   * Called on every `PLAYING` state change, including resuming after a pause.
   *
   * {@link onPlaybackStart} is latched so history is recorded once; progress
   * reporting needs the opposite, a signal for each time playback actually
   * resumes, so it can restart its timer.
   */
  onPlaybackPlay?: () => void;
  /** Called when the player reports `PAUSED` (never `CUED` on load). */
  onPlaybackPause?: () => void;
  /**
   * Called once the API has created and readied the player, with a handle for
   * reading the clock and seeking.
   */
  onPlayerReady?: (handle: YoutubePlayerHandle) => void;
  /**
   * Called each time the player reports `ENDED`.
   *
   * The player owns the IFrame API event; the watch page decides what happens
   * next. Unlike {@link onPlaybackStart} this is not latched, because a viewer
   * can seek back and finish the same video again.
   */
  onPlaybackEnd?: () => void;
  /**
   * Toggles theater mode when the viewer presses `T`.
   *
   * Theater mode is a layout concern owned by T77; until that wiring exists the
   * prop is omitted and `T` is a no-op. The player never changes its own width.
   */
  onToggleTheater?: () => void;
  /**
   * Extra controls rendered at the end of the player's control row.
   *
   * The watch page uses this for the listen-mode switch (T86) so the mode
   * control shares the player's control row instead of adding another one.
   */
  modeControl?: ReactNode;
}

/**
 * Official YouTube embed for `/watch/[videoId]`.
 *
 * Playback is the real YouTube IFrame API: no media is proxied or downloaded,
 * and YouTube keeps ownership of its controls, captions and fullscreen
 * behaviour. `youtube-nocookie.com` avoids advertising cookies until the viewer
 * starts playback.
 *
 * ## Loading
 *
 * The API script is requested only when the player is near the viewport (or
 * immediately when `IntersectionObserver` is unavailable), so a page that is
 * never scrolled does not pay for it. The script itself is loaded once through
 * {@link loadYoutubeIframeApi}; every player shares that promise.
 *
 * ## Accessibility
 *
 * The API creates the iframe itself and does not know the video title, so
 * `onReady` copies the title onto the iframe. The 16:9 box is rendered by React
 * and never replaced, so space is reserved before the API loads and the page
 * never shifts.
 *
 * ## Failure
 *
 * A third-party embed can still be blocked (extensions, consent walls, network
 * policy). A rejected loader or a throwing constructor is swallowed and the
 * plain "Open on YouTube" link stays visible beside the empty box.
 */
export function YoutubePlayer({
  videoId,
  title,
  className,
  onPlaybackStart,
  onPlaybackPlay,
  onPlaybackPause,
  onPlayerReady,
  onPlaybackEnd,
  onToggleTheater,
  modeControl,
}: YoutubePlayerProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef(title);
  const onPlaybackStartRef = useRef(onPlaybackStart);
  const onPlaybackPlayRef = useRef(onPlaybackPlay);
  const onPlaybackPauseRef = useRef(onPlaybackPause);
  const onPlayerReadyRef = useRef(onPlayerReady);
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  const playerRef = useRef<WatchShortcutPlayer | null>(null);

  const getPlayer = useCallback(() => playerRef.current, []);
  const getContainer = useCallback(() => boxRef.current, []);

  const { isHelpOpen, openHelp, closeHelp } = useWatchShortcuts({
    getPlayer,
    getContainer,
    onToggleTheater,
  });

  // Keep the latest title and callback without re-creating the player. Both
  // effects are declared before the player effect so the values are current by
  // the time the API can call back.
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    onPlaybackStartRef.current = onPlaybackStart;
  }, [onPlaybackStart]);

  useEffect(() => {
    onPlaybackPlayRef.current = onPlaybackPlay;
  }, [onPlaybackPlay]);

  useEffect(() => {
    onPlaybackPauseRef.current = onPlaybackPause;
  }, [onPlaybackPause]);

  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady;
  }, [onPlayerReady]);

  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
  }, [onPlaybackEnd]);

  useEffect(() => {
    const box = boxRef.current;

    if (box === null) {
      return;
    }

    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    let mount: HTMLDivElement | null = null;
    let player: YoutubeIframePlayer | null = null;
    let hasStarted = false;

    const notifyPlaybackStart = () => {
      if (hasStarted) {
        return;
      }

      hasStarted = true;
      onPlaybackStartRef.current?.();
    };

    /** Reads a player number without letting a blocked/destroyed API throw. */
    const readNumber = (read: (() => number) | undefined, fallback: number): number => {
      try {
        const value = read?.();

        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
      } catch {
        return fallback;
      }
    };

    // One handle per mounted player. Its methods read the live instance, so a
    // caller can hold it across a pause and still get the current position.
    const handle: YoutubePlayerHandle = {
      getCurrentTime: () => readNumber(player?.getCurrentTime?.bind(player), 0),
      getDuration: () => readNumber(player?.getDuration?.bind(player), 0),
      seekTo: (seconds) => {
        if (!Number.isFinite(seconds)) {
          return;
        }

        try {
          player?.seekTo?.(Math.max(seconds, 0), true);
        } catch {
          // A destroyed player is a no-op, not an error for the page.
        }
      },
      play: () => {
        try {
          player?.playVideo?.();
        } catch {
          // A destroyed player is a no-op, not an error for the page.
        }
      },
      pause: () => {
        try {
          player?.pauseVideo?.();
        } catch {
          // A destroyed player is a no-op, not an error for the page.
        }
      },
      getPlaybackState: () => {
        try {
          const value = player?.getPlayerState?.();

          return typeof value === "number" && Number.isFinite(value)
            ? value
            : YOUTUBE_PLAYER_STATE.UNSTARTED;
        } catch {
          return YOUTUBE_PLAYER_STATE.UNSTARTED;
        }
      },
      getVolume: () => readNumber(player?.getVolume?.bind(player), 100),
      setVolume: (volume) => {
        if (!Number.isFinite(volume)) {
          return;
        }

        try {
          player?.setVolume?.(Math.min(Math.max(volume, 0), 100));
        } catch {
          // A destroyed player is a no-op, not an error for the page.
        }
      },
      isMuted: () => {
        try {
          return player?.isMuted?.() === true;
        } catch {
          return false;
        }
      },
      setMuted: (muted) => {
        try {
          if (muted) {
            player?.mute?.();
            return;
          }

          player?.unMute?.();
        } catch {
          // A destroyed player is a no-op, not an error for the page.
        }
      },
    };

    const createPlayer = async () => {
      try {
        const api = await loadYoutubeIframeApi();

        if (cancelled) {
          return;
        }

        // `YT.Player` replaces the element it is given with its own iframe, so
        // the target must be a node React does not own. React keeps the 16:9
        // box; this mount node is created and removed imperatively.
        mount = document.createElement("div");
        mount.className = "size-full";
        box.appendChild(mount);

        player = new api.Player(mount, {
          videoId,
          host: EMBED_HOST,
          // Fill the React-owned 16:9 box. The API otherwise writes fixed
          // pixel attributes onto the iframe, which would not scale with it.
          width: "100%",
          height: "100%",
          playerVars: { rel: PLAYER_VARS.rel, autoplay: PLAYER_VARS.autoplay },
          events: {
            onReady(event) {
              const iframe = event.target.getIframe();

              if (iframe === null || iframe === undefined) {
                return;
              }

              iframe.title = `${titleRef.current}${IFRAME_TITLE_SUFFIX}`;
              iframe.setAttribute("loading", "lazy");
              iframe.style.width = "100%";
              iframe.style.height = "100%";
              iframe.style.border = "0";

              onPlayerReadyRef.current?.(handle);
            },
            onStateChange(event) {
              if (event.data === YOUTUBE_PLAYER_STATE.ENDED) {
                onPlaybackEndRef.current?.();
                return;
              }

              if (event.data === YOUTUBE_PLAYER_STATE.PLAYING) {
                notifyPlaybackStart();
                onPlaybackPlayRef.current?.();
                return;
              }

              if (event.data === YOUTUBE_PLAYER_STATE.PAUSED) {
                onPlaybackPauseRef.current?.();
              }
            },
          },
        });

        // Keyboard shortcuts call the same instance through the official API.
        // The loader's public type only promises the two members this module
        // used before; the real `YT.Player` has the rest at runtime.
        playerRef.current = player as unknown as WatchShortcutPlayer;
      } catch {
        // Blocked script, consent wall or an unavailable API: keep the fallback
        // link and leave the reserved box empty rather than crashing the page.
      }
    };

    const startWhenVisible = () => {
      void createPlayer();
    };

    if (typeof IntersectionObserver === "undefined") {
      startWhenVisible();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) {
            return;
          }

          observer?.disconnect();
          startWhenVisible();
        },
        { rootMargin: OBSERVER_ROOT_MARGIN },
      );

      observer.observe(box);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      playerRef.current = null;

      if (player !== null) {
        try {
          player.destroy();
        } catch {
          // The iframe may already be gone; unmounting must not throw.
        }

        player = null;
      }

      // No-op when the API replaced the mount node with its iframe.
      mount?.remove();
      mount = null;
    };
  }, [videoId]);

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  return (
    <div data-slot="youtube-player" className={cn("flex min-w-0 flex-col gap-2", className)}>
      {/*
        The wrapper owns the 16:9 box, so the space is reserved before the
        iframe loads and the page never shifts. The iframe fills it absolutely.
      */}
      <div
        ref={boxRef}
        data-slot="youtube-player-frame"
        className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black"
      />

      <div className="flex flex-wrap items-center gap-2">
        {/*
          Fullscreen and picture-in-picture share the code path with the
          keyboard shortcuts: the box passed here is the same fullscreen
          target `F` uses.
        */}
        <PlayerControls getContainer={getContainer} />

        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 self-start rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          Open on YouTube
          <span className="sr-only"> (opens in a new tab)</span>
        </a>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openHelp}
          className="min-h-11 gap-1.5 text-sm text-muted-foreground"
        >
          <kbd
            aria-hidden="true"
            className="rounded border border-border bg-muted px-1 font-mono text-[0.7rem]"
          >
            ?
          </kbd>
          Keyboard shortcuts
        </Button>

        {modeControl}
      </div>

      <WatchShortcutsOverlay open={isHelpOpen} onClose={closeHelp} />
    </div>
  );
}
