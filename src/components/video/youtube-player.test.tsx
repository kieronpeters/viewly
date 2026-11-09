import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

interface FakePlayer extends YoutubeIframePlayer {
  readonly options: YoutubePlayerOptions;
  readonly iframe: HTMLIFrameElement;
}

/**
 * A fake `YT.Player` that mirrors the two things the component relies on:
 * the constructor replaces the element it is given with an iframe, and the
 * options object exposes the callbacks the test drives by hand.
 */
function createFakeApi(options: { throwOnCreate?: boolean } = {}) {
  const players: FakePlayer[] = [];

  class Player implements FakePlayer {
    readonly options: YoutubePlayerOptions;
    readonly iframe: HTMLIFrameElement;
    readonly destroy = vi.fn(() => {
      this.iframe.remove();
    });

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
