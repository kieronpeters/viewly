"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

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
export function YoutubePlayer({ videoId, title, className, onPlaybackStart }: YoutubePlayerProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef(title);
  const onPlaybackStartRef = useRef(onPlaybackStart);

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
            },
            onStateChange(event) {
              if (event.data === YOUTUBE_PLAYER_STATE.PLAYING) {
                notifyPlaybackStart();
              }
            },
          },
        });
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
    </div>
  );
}
