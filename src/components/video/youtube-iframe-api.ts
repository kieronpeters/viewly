/**
 * Shared loader for the YouTube IFrame Player API.
 *
 * The API is a single global script (`https://www.youtube.com/iframe_api`) that
 * replaces `window.YT` and calls `window.onYouTubeIframeAPIReady` when it is
 * ready. This module owns both steps so every player instance shares one
 * promise and one `<script>` element, no matter how many players mount.
 *
 * ## Why not `next/script`
 *
 * The API does not expose a module: the only completion signal is the global
 * callback, and the callback has to be installed *before* the script is
 * appended. Owning the tag here keeps that ordering explicit and makes the
 * loader mockable in jsdom, which never executes the real script.
 *
 * ## Failure
 *
 * A blocked request (extension, consent wall, network policy) rejects the
 * promise and clears it, so a later mount can retry. The player treats a
 * rejection as "no API": it keeps the plain "Open on YouTube" link and never
 * throws.
 *
 * ## Types
 *
 * `@types/youtube` is not a dependency, so the module declares the small
 * structural subset the player actually uses. Only the members below are
 * promised to exist; the real API has many more.
 */

/** URL of the official IFrame API bootstrap script. */
export const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";

/**
 * Player states used by the API. Mirrors `YT.PlayerState`; kept here so the
 * player does not need a runtime handle on the global object.
 */
export const YOUTUBE_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** Event payload shared by the API's player events. */
export interface YoutubePlayerEvent {
  /** The player that emitted the event. */
  target: YoutubeIframePlayer;
}

/** `onStateChange` payload; `data` is a {@link YOUTUBE_PLAYER_STATE} value. */
export interface YoutubePlayerStateChangeEvent extends YoutubePlayerEvent {
  data: number;
}

/** `onError` payload; `data` is the API's numeric error code. */
export interface YoutubePlayerErrorEvent extends YoutubePlayerEvent {
  data: number;
}

/** Options accepted by `new YT.Player(element, options)`. */
export interface YoutubePlayerOptions {
  /** 11-character YouTube video id. */
  videoId: string;
  /** Embed host; `youtube-nocookie.com` avoids advertising cookies until play. */
  host?: string;
  /** Rendered width; a CSS length fills the reserved 16:9 box. */
  width?: number | string;
  /** Rendered height; a CSS length fills the reserved 16:9 box. */
  height?: number | string;
  /** Player parameters, for example `rel` and `autoplay`. */
  playerVars?: Record<string, number | string>;
  events?: {
    onReady?: (event: YoutubePlayerEvent) => void;
    onStateChange?: (event: YoutubePlayerStateChangeEvent) => void;
    onError?: (event: YoutubePlayerErrorEvent) => void;
  };
}

/**
 * The subset of a `YT.Player` instance this app calls.
 *
 * The time methods are optional because the player feature tests use light
 * doubles that only need `getIframe`/`destroy`; the real API always provides
 * them. Callers that need a number must handle a missing method (see
 * `YoutubePlayerHandle` in `youtube-player.tsx`).
 */
export interface YoutubeIframePlayer {
  /** The iframe the API created for this player. */
  getIframe(): HTMLIFrameElement | null | undefined;
  /** Removes the iframe and detaches the player. */
  destroy(): void;
  /** Current playback position in seconds, as a float. */
  getCurrentTime?(): number;
  /** Total duration in seconds; `0` while the video metadata is unknown. */
  getDuration?(): number;
  /** Seeks to `seconds`; `allowSeekAhead` lets the API load past the buffer. */
  seekTo?(seconds: number, allowSeekAhead?: boolean): void;
}

/** The subset of `window.YT` this app needs. */
export interface YoutubeIframeApi {
  Player: new (element: HTMLElement, options: YoutubePlayerOptions) => YoutubeIframePlayer;
}

declare global {
  interface Window {
    /** Set by the IFrame API script once it has executed. */
    YT?: YoutubeIframeApi;
    /** Called by the IFrame API script when `window.YT` is ready. */
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * The in-flight (or resolved) load, shared by every caller.
 *
 * A rejected load resets this to `null` so the next mount can try again.
 */
let apiPromise: Promise<YoutubeIframeApi> | null = null;

/**
 * Resolves with `window.YT` once the IFrame API is ready.
 *
 * The promise is memoised: concurrent and later calls reuse the same script
 * and the same promise. A browser that already has `window.YT.Player` (for
 * example after a client-side navigation) resolves without touching the DOM.
 */
export function loadYoutubeIframeApi(): Promise<YoutubeIframeApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The YouTube IFrame API can only load in a browser."));
  }

  if (window.YT?.Player !== undefined) {
    return Promise.resolve(window.YT);
  }

  if (apiPromise !== null) {
    return apiPromise;
  }

  apiPromise = new Promise<YoutubeIframeApi>((resolve, reject) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;

    const succeed = (api: YoutubeIframeApi) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(api);
    };

    const fail = (message: string) => {
      if (settled) {
        return;
      }

      settled = true;
      // Remove our tag so a retry installs a fresh one instead of reusing a
      // script that already failed (and therefore will never call back).
      script?.remove();
      script = null;
      apiPromise = null;
      reject(new Error(message));
    };

    // Preserve a callback installed by another copy of this module (HMR) or by
    // the host page; the API calls the single global callback exactly once.
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();

      const api = window.YT;

      if (api?.Player !== undefined) {
        succeed(api);
        return;
      }

      fail("The YouTube IFrame API loaded without a Player constructor.");
    };

    // Reuse a tag that is already in the document instead of adding a second
    // script; its global callback is the one installed above. The error
    // listener still belongs to this promise, so a failed tag rejects instead
    // of leaving the player waiting forever.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_URL}"]`,
    );

    if (existing !== null) {
      existing.addEventListener("error", () => {
        fail("The YouTube IFrame API could not be loaded.");
      });

      return;
    }

    script = document.createElement("script");

    script.src = YOUTUBE_IFRAME_API_URL;
    script.async = true;
    script.addEventListener("error", () => {
      fail("The YouTube IFrame API could not be loaded.");
    });

    document.head.appendChild(script);
  });

  return apiPromise;
}
