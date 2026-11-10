import { describe, expect, it, vi } from "vitest";

import {
  applyWatchShortcut,
  isEditableTarget,
  resolveWatchShortcut,
  type WatchShortcutContext,
  type WatchShortcutKeyEvent,
  type WatchShortcutPlayer,
} from "./watch-shortcuts";

/** A keydown event as the DOM would deliver it, targeting the page body. */
function press(key: string, overrides: Partial<WatchShortcutKeyEvent> = {}) {
  return resolveWatchShortcut({ key, target: document.body, ...overrides }, false);
}

function pressInDialog(key: string, overrides: Partial<WatchShortcutKeyEvent> = {}) {
  return resolveWatchShortcut({ key, target: document.body, ...overrides }, true);
}

/** An element with a mutable set of optional player methods. */
function createPlayer(overrides: Partial<WatchShortcutPlayer> = {}): WatchShortcutPlayer {
  return {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: vi.fn(() => 30),
    getDuration: vi.fn(() => 100),
    getVolume: vi.fn(() => 50),
    setVolume: vi.fn(),
    isMuted: vi.fn(() => false),
    mute: vi.fn(),
    unMute: vi.fn(),
    getPlayerState: vi.fn(() => 2),
    ...overrides,
  };
}

function createContext(overrides: Partial<WatchShortcutContext> = {}): WatchShortcutContext {
  return {
    player: createPlayer(),
    container: null,
    toggleHelp: vi.fn(),
    closeHelp: vi.fn(),
    ...overrides,
  };
}

describe("resolveWatchShortcut key mapping", () => {
  it("maps Space and K to play-pause", () => {
    expect(press(" ")).toEqual({ type: "play-pause" });
    expect(press("k")).toEqual({ type: "play-pause" });
    expect(press("K")).toEqual({ type: "play-pause" });
    // Legacy browsers report the space bar by name.
    expect(press("Spacebar")).toEqual({ type: "play-pause" });
  });

  it("maps J/L and the horizontal arrows to seeks", () => {
    expect(press("j")).toEqual({ type: "seek", deltaSeconds: -10 });
    expect(press("l")).toEqual({ type: "seek", deltaSeconds: 10 });
    expect(press("ArrowLeft")).toEqual({ type: "seek", deltaSeconds: -5 });
    expect(press("ArrowRight")).toEqual({ type: "seek", deltaSeconds: 5 });
  });

  it("maps the vertical arrows to volume, M to mute, F to fullscreen and T to theater", () => {
    expect(press("ArrowUp")).toEqual({ type: "volume", delta: 5 });
    expect(press("ArrowDown")).toEqual({ type: "volume", delta: -5 });
    expect(press("m")).toEqual({ type: "mute" });
    expect(press("f")).toEqual({ type: "fullscreen" });
    expect(press("t")).toEqual({ type: "theater" });
  });

  it("maps 0-9 to percentage seeks", () => {
    expect(press("0")).toEqual({ type: "seek-to-percent", percent: 0 });
    expect(press("1")).toEqual({ type: "seek-to-percent", percent: 10 });
    expect(press("5")).toEqual({ type: "seek-to-percent", percent: 50 });
    expect(press("9")).toEqual({ type: "seek-to-percent", percent: 90 });
  });

  it("maps ? to the overlay and Escape only while it is open", () => {
    expect(press("?")).toEqual({ type: "toggle-help" });
    expect(press("/", { shiftKey: true })).toEqual({ type: "toggle-help" });
    expect(press("?")).not.toBeNull();
    expect(press("Escape")).toBeNull();
    expect(pressInDialog("Escape")).toEqual({ type: "close-help" });
    expect(pressInDialog("?")).toEqual({ type: "toggle-help" });
  });

  it("ignores other keys", () => {
    expect(press("a")).toBeNull();
    expect(press("Enter")).toBeNull();
    expect(press("F1")).toBeNull();
  });

  it("ignores every shortcut while the overlay is open except ? and Escape", () => {
    expect(pressInDialog("k")).toBeNull();
    expect(pressInDialog("ArrowRight")).toBeNull();
    expect(pressInDialog("f")).toBeNull();
    expect(pressInDialog("5")).toBeNull();
  });

  it("does not repeat toggle shortcuts but repeats seeks and volume", () => {
    expect(press("k", { repeat: true })).toBeNull();
    expect(press("m", { repeat: true })).toBeNull();
    expect(press("f", { repeat: true })).toBeNull();
    expect(press("t", { repeat: true })).toBeNull();
    expect(press("?", { repeat: true })).toBeNull();
    expect(press("j", { repeat: true })).toEqual({ type: "seek", deltaSeconds: -10 });
    expect(press("ArrowUp", { repeat: true })).toEqual({ type: "volume", delta: 5 });
  });

  it("leaves modifier chords and consumed or composing events alone", () => {
    expect(press("k", { ctrlKey: true })).toBeNull();
    expect(press("k", { metaKey: true })).toBeNull();
    expect(press("k", { altKey: true })).toBeNull();
    expect(press("k", { defaultPrevented: true })).toBeNull();
    expect(press("k", { isComposing: true })).toBeNull();
  });
});

describe("isEditableTarget and the input-focus guard", () => {
  it("ignores shortcuts inside inputs, textareas and selects", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const option = document.createElement("option");

    select.append(option);

    for (const element of [input, textarea, select, option]) {
      expect(isEditableTarget(element)).toBe(true);
      expect(resolveWatchShortcut({ key: " ", target: element }, false)).toBeNull();
    }
  });

  it("ignores shortcuts inside contenteditable regions and their children", () => {
    const editable = document.createElement("div");

    editable.setAttribute("contenteditable", "true");

    const child = document.createElement("span");

    editable.append(child);

    document.body.append(editable);

    try {
      expect(isEditableTarget(editable)).toBe(true);
      expect(isEditableTarget(child)).toBe(true);
      expect(resolveWatchShortcut({ key: "k", target: child }, false)).toBeNull();
    } finally {
      editable.remove();
    }
  });

  it("does not treat a non-editable element as an input", () => {
    const div = document.createElement("div");

    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("applyWatchShortcut", () => {
  it("pauses a playing player and plays a paused one", () => {
    const pauseVideo = vi.fn();
    const playVideo = vi.fn();

    applyWatchShortcut(
      { type: "play-pause" },
      createContext({
        player: createPlayer({
          pauseVideo,
          playVideo,
          getPlayerState: vi.fn(() => 1),
        }),
      }),
    );

    expect(pauseVideo).toHaveBeenCalledTimes(1);
    expect(playVideo).not.toHaveBeenCalled();

    applyWatchShortcut(
      { type: "play-pause" },
      createContext({
        player: createPlayer({
          pauseVideo,
          playVideo,
          getPlayerState: vi.fn(() => 2),
        }),
      }),
    );

    expect(playVideo).toHaveBeenCalledTimes(1);
  });

  it("seeks relative to the current time and never before zero", () => {
    const seekTo = vi.fn();

    applyWatchShortcut(
      { type: "seek", deltaSeconds: -10 },
      createContext({
        player: createPlayer({ seekTo, getCurrentTime: vi.fn(() => 30) }),
      }),
    );

    expect(seekTo).toHaveBeenLastCalledWith(20, true);

    applyWatchShortcut(
      { type: "seek", deltaSeconds: -10 },
      createContext({
        player: createPlayer({ seekTo, getCurrentTime: vi.fn(() => 4) }),
      }),
    );

    expect(seekTo).toHaveBeenLastCalledWith(0, true);
  });

  it("seeks to a percentage of the duration and clamps to the end", () => {
    const seekTo = vi.fn();
    const player = createPlayer({ seekTo, getDuration: vi.fn(() => 200) });

    applyWatchShortcut({ type: "seek-to-percent", percent: 50 }, createContext({ player }));
    expect(seekTo).toHaveBeenLastCalledWith(100, true);

    applyWatchShortcut({ type: "seek-to-percent", percent: 100 }, createContext({ player }));
    expect(seekTo).toHaveBeenLastCalledWith(200, true);
  });

  it("changes volume, clamps it and unmutes when raising it from zero", () => {
    const setVolume = vi.fn();
    const unMute = vi.fn();
    const player = createPlayer({
      setVolume,
      unMute,
      getVolume: vi.fn(() => 98),
      isMuted: vi.fn(() => true),
    });

    applyWatchShortcut({ type: "volume", delta: 5 }, createContext({ player }));

    expect(setVolume).toHaveBeenLastCalledWith(100);
    expect(unMute).toHaveBeenCalledTimes(1);

    const quietPlayer = createPlayer({
      setVolume,
      getVolume: vi.fn(() => 3),
      isMuted: vi.fn(() => true),
    });

    applyWatchShortcut({ type: "volume", delta: -5 }, createContext({ player: quietPlayer }));

    expect(setVolume).toHaveBeenLastCalledWith(0);
  });

  it("toggles mute from the player's current state", () => {
    const mute = vi.fn();
    const unMute = vi.fn();

    applyWatchShortcut(
      { type: "mute" },
      createContext({ player: createPlayer({ mute, unMute, isMuted: vi.fn(() => false) }) }),
    );

    expect(mute).toHaveBeenCalledTimes(1);

    applyWatchShortcut(
      { type: "mute" },
      createContext({ player: createPlayer({ mute, unMute, isMuted: vi.fn(() => true) }) }),
    );

    expect(unMute).toHaveBeenCalledTimes(1);
  });

  it("calls the theater callback when one is provided and does nothing otherwise", () => {
    const onToggleTheater = vi.fn();

    applyWatchShortcut({ type: "theater" }, createContext({ onToggleTheater }));

    expect(onToggleTheater).toHaveBeenCalledTimes(1);

    expect(() => applyWatchShortcut({ type: "theater" }, createContext())).not.toThrow();
  });

  it("requests fullscreen on the container", () => {
    const container = document.createElement("div");
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);

    container.requestFullscreen = requestFullscreen;

    applyWatchShortcut({ type: "fullscreen" }, createContext({ container }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the overlay through the callbacks", () => {
    const context = createContext();

    applyWatchShortcut({ type: "toggle-help" }, context);
    expect(context.toggleHelp).toHaveBeenCalledTimes(1);

    applyWatchShortcut({ type: "close-help" }, context);
    expect(context.closeHelp).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the player is unavailable or only partially implemented", () => {
    expect(() => {
      applyWatchShortcut({ type: "play-pause" }, createContext({ player: null }));
      applyWatchShortcut({ type: "seek", deltaSeconds: 10 }, createContext({ player: null }));
      applyWatchShortcut({ type: "volume", delta: 5 }, createContext({ player: null }));
      applyWatchShortcut({ type: "mute" }, createContext({ player: null }));
      applyWatchShortcut({ type: "seek-to-percent", percent: 50 }, createContext({ player: null }));
    }).not.toThrow();

    // A player object without the API methods must not throw either.
    expect(() => {
      applyWatchShortcut({ type: "play-pause" }, createContext({ player: {} }));
      applyWatchShortcut({ type: "seek", deltaSeconds: 10 }, createContext({ player: {} }));
      applyWatchShortcut({ type: "volume", delta: 5 }, createContext({ player: {} }));
      applyWatchShortcut({ type: "mute" }, createContext({ player: {} }));
      applyWatchShortcut({ type: "seek-to-percent", percent: 50 }, createContext({ player: {} }));
    }).not.toThrow();
  });
});
