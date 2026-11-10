/**
 * Keyboard shortcuts for the watch player.
 *
 * The module is intentionally framework-free: {@link resolveWatchShortcut} maps
 * a key event to an intent, and {@link applyWatchShortcut} performs that intent
 * against a structural subset of the YouTube IFrame player. The React hook in
 * `use-watch-shortcuts.ts` only binds the two, which keeps the guard rules
 * (editable fields, modifier keys, repeated toggles) unit-testable without a
 * renderer.
 *
 * ## Player methods are optional
 *
 * `@types/youtube` is not a dependency, so the player is described by the small
 * structural subset this feature calls. Every method is optional: a player that
 * is still loading, was blocked, or is a light test double simply makes the
 * matching shortcut a no-op instead of throwing.
 */

import { YOUTUBE_PLAYER_STATE } from "./youtube-iframe-api";

/** Seconds moved by `J` / `L`. */
export const SEEK_STEP_LARGE = 10;

/** Seconds moved by `ArrowLeft` / `ArrowRight`. */
export const SEEK_STEP_SMALL = 5;

/** Volume points moved by `ArrowUp` / `ArrowDown`. */
export const VOLUME_STEP = 5;

/**
 * The player calls a shortcut needs.
 *
 * Mirrors `YT.Player` method names so the real instance can be handed over
 * without an adapter. All members are optional by design (see the module note).
 */
export interface WatchShortcutPlayer {
  playVideo?: () => void;
  pauseVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getVolume?: () => number;
  setVolume?: (volume: number) => void;
  isMuted?: () => boolean;
  mute?: () => void;
  unMute?: () => void;
  getPlayerState?: () => number;
}

/** What a key press means; deliberately decoupled from the player. */
export type WatchShortcutAction =
  | { type: "play-pause" }
  | { type: "seek"; deltaSeconds: number }
  | { type: "seek-to-percent"; percent: number }
  | { type: "volume"; delta: number }
  | { type: "mute" }
  | { type: "fullscreen" }
  | { type: "theater" }
  | { type: "toggle-help" }
  | { type: "close-help" };

/**
 * The key event fields the mapping reads.
 *
 * `KeyboardEvent` satisfies this structurally, so tests can pass a plain object.
 */
export interface WatchShortcutKeyEvent {
  key: string;
  target: EventTarget | null;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Elements whose keystrokes belong to the field, not to the player.
 *
 * `isContentEditable` already covers descendants of an editing host, so a span
 * inside `contenteditable="true"` is guarded too. `contenteditable="false"`
 * inside an editable region is not editable itself and is intentionally not
 * matched by the selector.
 */
const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";

/** True when typing in `target` must not trigger a player shortcut. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  return target.closest(EDITABLE_SELECTOR) !== null;
}

/** Shortcuts that may repeat while the key is held (seeking and volume). */
function isRepeatable(action: WatchShortcutAction): boolean {
  return action.type === "seek" || action.type === "seek-to-percent" || action.type === "volume";
}

/** Maps a lower-cased `KeyboardEvent.key` to an intent. */
function mapKey(key: string, shiftKey: boolean): WatchShortcutAction | null {
  switch (key) {
    case " ":
    case "spacebar":
    case "k":
      return { type: "play-pause" };
    case "j":
      return { type: "seek", deltaSeconds: -SEEK_STEP_LARGE };
    case "l":
      return { type: "seek", deltaSeconds: SEEK_STEP_LARGE };
    case "arrowleft":
      return { type: "seek", deltaSeconds: -SEEK_STEP_SMALL };
    case "arrowright":
      return { type: "seek", deltaSeconds: SEEK_STEP_SMALL };
    case "arrowup":
      return { type: "volume", delta: VOLUME_STEP };
    case "arrowdown":
      return { type: "volume", delta: -VOLUME_STEP };
    case "m":
      return { type: "mute" };
    case "f":
      return { type: "fullscreen" };
    case "t":
      return { type: "theater" };
    case "?":
      return { type: "toggle-help" };
    case "/":
      // Shift+/ is "?" on layouts where the shifted glyph is reported as "/".
      return shiftKey ? { type: "toggle-help" } : null;
    default:
      break;
  }

  // 0 jumps to the start, 1-9 to 10%-90% of the duration.
  if (key.length === 1 && key >= "0" && key <= "9") {
    return { type: "seek-to-percent", percent: Number(key) * 10 };
  }

  return null;
}

/**
 * Resolves a key event into an action, or `null` when the player must ignore it.
 *
 * Rules, in order:
 * 1. Already-consumed and IME-composition events are left alone.
 * 2. Events from inputs, textareas, selects and contenteditable regions are
 *    ignored so typing never controls playback.
 * 3. `Ctrl` / `Meta` / `Alt` chords belong to the browser or the page.
 * 4. While the shortcut panel is open only `?` and `Escape` are handled, so
 *    Tab and typing inside the dialog keep working normally.
 * 5. Held toggle keys do not fire twice; seeking and volume may repeat.
 */
export function resolveWatchShortcut(
  event: WatchShortcutKeyEvent,
  isHelpOpen: boolean,
): WatchShortcutAction | null {
  if (event.defaultPrevented === true || event.isComposing === true) {
    return null;
  }

  if (isEditableTarget(event.target)) {
    return null;
  }

  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) {
    return null;
  }

  const key = event.key.toLowerCase();

  if (isHelpOpen) {
    if (key === "escape") {
      return { type: "close-help" };
    }

    if (key === "?" || (key === "/" && event.shiftKey === true)) {
      return { type: "toggle-help" };
    }

    return null;
  }

  const action = mapKey(key, event.shiftKey === true);

  if (action === null) {
    return null;
  }

  if (event.repeat === true && !isRepeatable(action)) {
    return null;
  }

  return action;
}

/** Everything an action needs at execution time. */
export interface WatchShortcutContext {
  /** The live player, or `null` before/after it exists. */
  player: WatchShortcutPlayer | null;
  /** Element to put into fullscreen; the reserved video box. */
  container: HTMLElement | null;
  /** T77 owns theater mode; absent until then, so `T` is a no-op. */
  onToggleTheater?: () => void;
  toggleHelp: () => void;
  closeHelp: () => void;
}

/** Clamps `value` into `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Pauses a playing player, plays anything else. */
function togglePlayback(player: WatchShortcutPlayer): void {
  const { playVideo, pauseVideo } = player;

  if (playVideo === undefined || pauseVideo === undefined) {
    return;
  }

  if (player.getPlayerState?.() === YOUTUBE_PLAYER_STATE.PLAYING) {
    pauseVideo();
    return;
  }

  playVideo();
}

/** Moves playback by `deltaSeconds`, never before zero. */
function seekBy(player: WatchShortcutPlayer, deltaSeconds: number): void {
  const { getCurrentTime, seekTo } = player;

  if (getCurrentTime === undefined || seekTo === undefined) {
    return;
  }

  const current = getCurrentTime();
  const duration = player.getDuration?.();

  if (!Number.isFinite(current)) {
    return;
  }

  const target = Math.max(0, current + deltaSeconds);

  seekTo(
    duration !== undefined && Number.isFinite(duration) && duration > 0
      ? Math.min(target, duration)
      : target,
    true,
  );
}

/** Jumps to a percentage of the video; needs a known, non-zero duration. */
function seekToPercent(player: WatchShortcutPlayer, percent: number): void {
  const { getDuration, seekTo } = player;

  if (getDuration === undefined || seekTo === undefined) {
    return;
  }

  const duration = getDuration();

  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }

  seekTo((duration * clamp(percent, 0, 100)) / 100, true);
}

/** Raises or lowers the volume and unmutes when volume is restored. */
function changeVolume(player: WatchShortcutPlayer, delta: number): void {
  const { getVolume, setVolume } = player;

  if (setVolume === undefined) {
    return;
  }

  const current = getVolume?.() ?? 0;

  if (!Number.isFinite(current)) {
    return;
  }

  const next = clamp(current + delta, 0, 100);

  setVolume(next);

  if (next > 0 && player.isMuted?.() === true) {
    player.unMute?.();
  }
}

/** Toggles mute based on the player's current muted state. */
function toggleMute(player: WatchShortcutPlayer): void {
  if (player.isMuted?.() === true) {
    player.unMute?.();
    return;
  }

  player.mute?.();
}

/**
 * Toggles fullscreen on `container`.
 *
 * The promise is optional in jsdom and older browsers, and a rejected request
 * (a policy forbids it) must not surface as an unhandled rejection.
 */
function toggleFullscreen(container: HTMLElement | null): void {
  if (container === null) {
    return;
  }

  const ownerDocument = container.ownerDocument;

  if (ownerDocument.fullscreenElement === container) {
    const exit = ownerDocument.exitFullscreen?.();

    if (exit !== undefined) {
      void exit.catch(() => {});
    }

    return;
  }

  const request = container.requestFullscreen?.();

  if (request !== undefined) {
    void request.catch(() => {});
  }
}

/**
 * Performs an action; every missing player method makes the action a no-op.
 */
export function applyWatchShortcut(
  action: WatchShortcutAction,
  context: WatchShortcutContext,
): void {
  switch (action.type) {
    case "toggle-help":
      context.toggleHelp();
      return;
    case "close-help":
      context.closeHelp();
      return;
    case "theater":
      context.onToggleTheater?.();
      return;
    case "fullscreen":
      toggleFullscreen(context.container);
      return;
    default:
      break;
  }

  const player = context.player;

  if (player === null) {
    return;
  }

  switch (action.type) {
    case "play-pause":
      togglePlayback(player);
      return;
    case "seek":
      seekBy(player, action.deltaSeconds);
      return;
    case "seek-to-percent":
      seekToPercent(player, action.percent);
      return;
    case "volume":
      changeVolume(player, action.delta);
      return;
    case "mute":
      toggleMute(player);
      return;
    default:
      return;
  }
}

/** One row of the shortcuts panel. */
export interface WatchShortcutHint {
  /** Keys that trigger the row, rendered as `<kbd>` elements. */
  keys: readonly string[];
  /** What the keys do. */
  description: string;
}

/**
 * The list shown in the overlay. Kept next to the mapping so a new shortcut
 * cannot be added without a line in the panel.
 */
export const WATCH_SHORTCUT_HINTS: readonly WatchShortcutHint[] = [
  { keys: ["Space", "K"], description: "Play or pause" },
  { keys: ["J"], description: "Back 10 seconds" },
  { keys: ["L"], description: "Forward 10 seconds" },
  { keys: ["←", "→"], description: "Back or forward 5 seconds" },
  { keys: ["↑", "↓"], description: "Volume up or down" },
  { keys: ["M"], description: "Mute or unmute" },
  { keys: ["F"], description: "Fullscreen" },
  { keys: ["T"], description: "Theater mode" },
  { keys: ["0", "–", "9"], description: "Jump to 0%–90% of the video" },
  { keys: ["?"], description: "Show or hide this panel" },
  { keys: ["Esc"], description: "Close this panel" },
];
