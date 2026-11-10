import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

const { loadYoutubeIframeApiMock } = vi.hoisted(() => ({
  loadYoutubeIframeApiMock: vi.fn(),
}));

// jsdom cannot execute the real IFrame API, so the shared loader is replaced.
// The component still uses the real state constants and types.
vi.mock("@/components/video/youtube-iframe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/video/youtube-iframe-api")>();

  return { ...actual, loadYoutubeIframeApi: loadYoutubeIframeApiMock };
});

import {
  YOUTUBE_PLAYER_STATE,
  type YoutubeIframeApi,
  type YoutubeIframePlayer,
  type YoutubePlayerOptions,
} from "./youtube-iframe-api";
import type { WatchShortcutPlayer } from "./watch-shortcuts";
import { YoutubePlayer } from "./youtube-player";

/**
 * Hand-written fixture: the player only builds URLs from ids and titles, so
 * tests never touch the YouTube API or the network.
 */
const VIDEO = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
};

const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO.id}`;

interface FakePlayer extends YoutubeIframePlayer, WatchShortcutPlayer {
  readonly options: YoutubePlayerOptions;
  readonly iframe: HTMLIFrameElement;
  readonly playVideo: Mock;
  readonly pauseVideo: Mock;
  readonly seekTo: Mock;
  readonly getCurrentTime: Mock;
  readonly getDuration: Mock;
  readonly getVolume: Mock;
  readonly setVolume: Mock;
  readonly isMuted: Mock;
  readonly mute: Mock;
  readonly unMute: Mock;
  readonly getPlayerState: Mock;
}

/**
 * A fake `YT.Player` that mirrors the two things the component relies on:
 * the constructor replaces the element it is given with an iframe, and the
 * options object exposes the callbacks the test drives by hand.
 *
 * The playback controls are spy methods so keyboard shortcuts can be asserted
 * without the real API. `getPlayerState` defaults to paused, which means a
 * play-pause shortcut plays.
 */
function createFakeApi(options: { throwOnCreate?: boolean } = {}) {
  const players: FakePlayer[] = [];

  class Player implements FakePlayer {
    readonly options: YoutubePlayerOptions;
    readonly iframe: HTMLIFrameElement;
    readonly destroy = vi.fn(() => {
      this.iframe.remove();
    });
    readonly playVideo = vi.fn();
    readonly pauseVideo = vi.fn();
    readonly seekTo = vi.fn();
    readonly getCurrentTime = vi.fn(() => 30);
    readonly getDuration = vi.fn(() => 100);
    readonly getVolume = vi.fn(() => 50);
    readonly setVolume = vi.fn();
    readonly isMuted = vi.fn(() => false);
    readonly mute = vi.fn();
    readonly unMute = vi.fn();
    readonly getPlayerState = vi.fn(() => YOUTUBE_PLAYER_STATE.PAUSED);

    constructor(element: HTMLElement, playerOptions: YoutubePlayerOptions) {
      if (options.throwOnCreate === true) {
        throw new Error("Player unavailable");
      }

      this.options = playerOptions;
      this.iframe = document.createElement("iframe");
      element.replaceWith(this.iframe);
      players.push(this);
    }

    getIframe() {
      return this.iframe;
    }
  }

  const api: YoutubeIframeApi = { Player: Player as unknown as YoutubeIframeApi["Player"] };

  return { api, players };
}

/** Renders the player and waits until the API has created it. */
async function renderReadyPlayer(
  props: Partial<ComponentProps<typeof YoutubePlayer>> = {},
): Promise<{ players: FakePlayer[]; container: HTMLElement }> {
  const { api, players } = createFakeApi();

  loadYoutubeIframeApiMock.mockResolvedValue(api);

  const { container } = render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} {...props} />);

  await waitFor(() => expect(players).toHaveLength(1));

  return { players, container };
}

/** Sends a keydown to the page, as a viewer's keyboard would. */
function pressKey(key: string, target: Element = document.body) {
  fireEvent.keyDown(target, { key });
}

/** Fires one API event inside `act`, as the iframe script would. */
function emitStateChange(player: FakePlayer, data: number) {
  player.options.events?.onStateChange?.({ target: player, data });
}

beforeEach(() => {
  loadYoutubeIframeApiMock.mockReset();
});

describe("YoutubePlayer", () => {
  it("reserves the 16:9 box and keeps the fallback link while the API loads", () => {
    loadYoutubeIframeApiMock.mockReturnValue(new Promise(() => {}));

    const { container } = render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    const box = container.querySelector('[data-slot="youtube-player-frame"]');

    expect(box).toHaveClass("relative", "aspect-video", "w-full", "rounded-xl", "overflow-hidden");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /open on youtube/i })).toHaveAttribute(
      "href",
      WATCH_URL,
    );
  });

  it("creates one player on the nocookie host with rel=0 and autoplay off", async () => {
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    const { container } = render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    expect(loadYoutubeIframeApiMock).toHaveBeenCalledTimes(1);
    expect(player.options).toMatchObject({
      videoId: VIDEO.id,
      host: "https://www.youtube-nocookie.com",
      width: "100%",
      height: "100%",
      playerVars: { rel: 0, autoplay: 0 },
    });
    // Never a custom media element: the official player is the only source.
    expect(container.querySelector("video")).toBeNull();

    act(() => {
      player.options.events?.onReady?.({ target: player });
    });

    const iframe = player.iframe;

    expect(iframe).toHaveAttribute("title", expect.stringContaining(VIDEO.title));
    expect(iframe).toHaveAccessibleName(
      new RegExp(VIDEO.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    expect(iframe).toHaveAttribute("loading", "lazy");
    // The API's iframe must fill the React-owned 16:9 box.
    expect(iframe.style.width).toBe("100%");
    expect(iframe.style.height).toBe("100%");
    expect(iframe.parentElement).toBe(
      container.querySelector('[data-slot="youtube-player-frame"]'),
    );
  });

  it("fires onPlaybackStart once when the player starts playing", async () => {
    const { api, players } = createFakeApi();
    const onPlaybackStart = vi.fn();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(
      <YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} onPlaybackStart={onPlaybackStart} />,
    );

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => {
      player.options.events?.onReady?.({ target: player });
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      // A seek re-enters PLAYING; the mount has already recorded its view.
      emitStateChange(player, YOUTUBE_PLAYER_STATE.BUFFERING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PAUSED);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    expect(onPlaybackStart).toHaveBeenCalledTimes(1);
  });

  it("does not fire on ready, pause, buffering or a queued state", async () => {
    const { api, players } = createFakeApi();
    const onPlaybackStart = vi.fn();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(
      <YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} onPlaybackStart={onPlaybackStart} />,
    );

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => {
      player.options.events?.onReady?.({ target: player });
      emitStateChange(player, YOUTUBE_PLAYER_STATE.UNSTARTED);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.CUED);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.BUFFERING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PAUSED);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.ENDED);
    });

    expect(onPlaybackStart).not.toHaveBeenCalled();
  });

  it("fires onPlaybackEnd each time the player reports ENDED", async () => {
    const { api, players } = createFakeApi();
    const onPlaybackStart = vi.fn();
    const onPlaybackEnd = vi.fn();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(
      <YoutubePlayer
        videoId={VIDEO.id}
        title={VIDEO.title}
        onPlaybackStart={onPlaybackStart}
        onPlaybackEnd={onPlaybackEnd}
      />,
    );

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => {
      player.options.events?.onReady?.({ target: player });
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PAUSED);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.BUFFERING);
    });

    expect(onPlaybackEnd).not.toHaveBeenCalled();

    act(() => {
      emitStateChange(player, YOUTUBE_PLAYER_STATE.ENDED);
    });

    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    // Finishing the video is not a second view.
    expect(onPlaybackStart).toHaveBeenCalledTimes(1);

    // Seeking back and finishing again is a new ENDED, not a latched callback.
    act(() => {
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.ENDED);
    });

    expect(onPlaybackEnd).toHaveBeenCalledTimes(2);
  });

  it("keeps the fallback link and does not crash when the script fails", async () => {
    loadYoutubeIframeApiMock.mockRejectedValue(new Error("Blocked by the browser"));

    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    await waitFor(() => expect(loadYoutubeIframeApiMock).toHaveBeenCalledTimes(1));

    expect(document.querySelector("iframe")).toBeNull();
    const link = screen.getByRole("link", { name: /open on youtube/i });

    expect(link).toHaveAttribute("href", WATCH_URL);
    expect(link).toBeVisible();
  });

  it("keeps the fallback link when the player constructor throws", async () => {
    const { api } = createFakeApi({ throwOnCreate: true });
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    await waitFor(() => expect(loadYoutubeIframeApiMock).toHaveBeenCalledTimes(1));

    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /open on youtube/i })).toBeVisible();
  });

  it("destroys the player and removes its iframe on unmount", async () => {
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    const { unmount } = render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    unmount();

    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("YoutubePlayer keyboard shortcuts", () => {
  it("does not change playback on mount", async () => {
    const { players } = await renderReadyPlayer();

    const player = players[0];

    expect(player.playVideo).not.toHaveBeenCalled();
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.setVolume).not.toHaveBeenCalled();
    expect(player.mute).not.toHaveBeenCalled();
    expect(player.unMute).not.toHaveBeenCalled();
  });

  it("plays and pauses with Space and K", async () => {
    const { players } = await renderReadyPlayer();

    const player = players[0];

    player.getPlayerState.mockReturnValue(YOUTUBE_PLAYER_STATE.PLAYING);
    pressKey(" ");

    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(player.playVideo).not.toHaveBeenCalled();

    player.getPlayerState.mockReturnValue(YOUTUBE_PLAYER_STATE.PAUSED);
    pressKey("k");

    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });

  it("seeks with J/L, the arrows and the number row", async () => {
    const { players } = await renderReadyPlayer();

    const player = players[0];

    player.getCurrentTime.mockReturnValue(30);

    pressKey("j");
    expect(player.seekTo).toHaveBeenLastCalledWith(20, true);

    pressKey("l");
    expect(player.seekTo).toHaveBeenLastCalledWith(40, true);

    pressKey("ArrowLeft");
    expect(player.seekTo).toHaveBeenLastCalledWith(25, true);

    pressKey("ArrowRight");
    expect(player.seekTo).toHaveBeenLastCalledWith(35, true);

    pressKey("5");
    expect(player.seekTo).toHaveBeenLastCalledWith(50, true);

    pressKey("0");
    expect(player.seekTo).toHaveBeenLastCalledWith(0, true);
  });

  it("changes volume and toggles mute", async () => {
    const { players } = await renderReadyPlayer();

    const player = players[0];

    player.getVolume.mockReturnValue(50);

    pressKey("ArrowUp");
    expect(player.setVolume).toHaveBeenLastCalledWith(55);

    pressKey("ArrowDown");
    expect(player.setVolume).toHaveBeenLastCalledWith(45);

    player.isMuted.mockReturnValue(false);
    pressKey("m");
    expect(player.mute).toHaveBeenCalledTimes(1);

    player.isMuted.mockReturnValue(true);
    pressKey("m");
    expect(player.unMute).toHaveBeenCalledTimes(1);
  });

  it("requests fullscreen on the reserved player box", async () => {
    const { container } = await renderReadyPlayer();

    const frame = container.querySelector<HTMLElement>('[data-slot="youtube-player-frame"]');

    expect(frame).not.toBeNull();

    const requestFullscreen = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(frame, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    });

    pressKey("f");

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleTheater for T and does not resize the player", async () => {
    const onToggleTheater = vi.fn();
    const { players } = await renderReadyPlayer({ onToggleTheater });

    pressKey("t");

    expect(onToggleTheater).toHaveBeenCalledTimes(1);
    // Theater is a layout concern: the player itself is never resized or seeked.
    expect(players[0].seekTo).not.toHaveBeenCalled();
    expect(players[0].pauseVideo).not.toHaveBeenCalled();
  });

  it("keeps T a no-op while no theater callback is wired", async () => {
    await renderReadyPlayer();

    expect(() => pressKey("t")).not.toThrow();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores shortcuts while focus is in an input or contenteditable", async () => {
    const { api, players } = createFakeApi();

    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(
      <div>
        <YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />
        <input aria-label="Search" />
        <div aria-label="Notes" contentEditable suppressContentEditableWarning />
      </div>,
    );

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];
    const input = screen.getByRole("textbox", { name: "Search" });

    input.focus();
    expect(input).toHaveFocus();

    pressKey(" ", input);
    pressKey("k", input);
    pressKey("ArrowRight", input);

    expect(player.playVideo).not.toHaveBeenCalled();
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(player.seekTo).not.toHaveBeenCalled();

    const notes = screen.getByLabelText("Notes");

    notes.focus();
    pressKey("l", notes);

    expect(player.seekTo).not.toHaveBeenCalled();

    // The same keys still work when focus is on the page.
    pressKey("l", document.body);

    expect(player.seekTo).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the player has not loaded", async () => {
    loadYoutubeIframeApiMock.mockReturnValue(new Promise(() => {}));

    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    await waitFor(() => expect(loadYoutubeIframeApiMock).toHaveBeenCalledTimes(1));

    expect(() => {
      for (const key of [" ", "k", "j", "l", "ArrowUp", "ArrowDown", "m", "f", "t", "5"]) {
        pressKey(key);
      }
    }).not.toThrow();

    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /open on youtube/i })).toBeVisible();
  });

  it("is a no-op when the player constructor fails", async () => {
    const { api } = createFakeApi({ throwOnCreate: true });

    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    await waitFor(() => expect(loadYoutubeIframeApiMock).toHaveBeenCalledTimes(1));

    expect(() => {
      pressKey(" ");
      pressKey("j");
      pressKey("m");
    }).not.toThrow();

    expect(document.querySelector("iframe")).toBeNull();
  });

  it("stops listening after unmount", async () => {
    const { api, players } = createFakeApi();

    loadYoutubeIframeApiMock.mockResolvedValue(api);

    const { unmount } = render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    unmount();

    expect(() => pressKey(" ")).not.toThrow();
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });

  it("opens the shortcut dialog with ? and closes it with ?", async () => {
    await renderReadyPlayer();

    pressKey("?");

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });

    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent("Play or pause");

    pressKey("?", dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("returns focus to the shortcuts button after Escape", async () => {
    await renderReadyPlayer();

    const trigger = screen.getByRole("button", { name: /keyboard shortcuts/i });

    act(() => trigger.focus());
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });

    expect(dialog).toHaveFocus();

    pressKey("Escape", dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe("YoutubePlayer fullscreen and picture-in-picture controls", () => {
  let fullscreenElement: Element | null = null;

  beforeEach(() => {
    fullscreenElement = null;

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
  });

  afterEach(() => {
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    delete (document as { pictureInPictureEnabled?: unknown }).pictureInPictureEnabled;
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  });

  /** Fires `fullscreenchange` after the document reports `element`. */
  function reportFullscreen(element: Element | null) {
    fullscreenElement = element;

    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
  }

  it("shows labelled controls for the reserved player box", async () => {
    const { container } = await renderReadyPlayer();

    const frame = container.querySelector('[data-slot="youtube-player-frame"]');
    const fullscreen = screen.getByRole("button", { name: "Fullscreen" });

    expect(frame).not.toBeNull();
    expect(fullscreen.closest('[data-slot="player-controls"]')).not.toBeNull();
    expect(fullscreen).toHaveAttribute("aria-pressed", "false");
    expect(fullscreen).toHaveClass("min-h-11", "min-w-11");
  });

  it("enters and exits fullscreen on the box the F shortcut uses", async () => {
    const { container } = await renderReadyPlayer();

    const frame = container.querySelector<HTMLElement>('[data-slot="youtube-player-frame"]');

    expect(frame).not.toBeNull();

    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(frame, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: request,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      writable: true,
      value: exit,
    });

    const button = screen.getByRole("button", { name: "Fullscreen" });

    fireEvent.click(button);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(frame);

    reportFullscreen(frame);

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(button);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);

    reportFullscreen(null);

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("reflects fullscreen that the F shortcut entered", async () => {
    const { container } = await renderReadyPlayer();

    const frame = container.querySelector<HTMLElement>('[data-slot="youtube-player-frame"]');
    const button = screen.getByRole("button", { name: "Fullscreen" });

    Object.defineProperty(frame, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    pressKey("f");
    reportFullscreen(frame);

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
  });

  it("works before the API has loaded", () => {
    loadYoutubeIframeApiMock.mockReturnValue(new Promise(() => {}));

    const { container } = render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    const frame = container.querySelector<HTMLElement>('[data-slot="youtube-player-frame"]');

    expect(frame).not.toBeNull();

    const request = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(frame, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: request,
    });

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("hides picture-in-picture for the iframe surface even when the browser supports it", async () => {
    // The official embed is cross-origin, so the page has no media element to
    // hand to the PiP API. The control must be absent, not dead.
    Object.defineProperty(document, "pictureInPictureEnabled", {
      configurable: true,
      get: () => true,
    });

    await renderReadyPlayer();

    expect(screen.queryByRole("button", { name: "Picture in picture" })).toBeNull();
  });
});
