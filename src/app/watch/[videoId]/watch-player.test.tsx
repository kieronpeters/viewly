import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadYoutubeIframeApiMock, recordViewMock } = vi.hoisted(() => ({
  loadYoutubeIframeApiMock: vi.fn(),
  recordViewMock: vi.fn(),
}));

// jsdom cannot execute the real IFrame API, so the shared loader is replaced.
vi.mock("@/components/video/youtube-iframe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/video/youtube-iframe-api")>();

  return { ...actual, loadYoutubeIframeApi: loadYoutubeIframeApiMock };
});
// The wrapper owns the write; the action is a Server Action reference in jsdom.
vi.mock("@/features/library/history-actions", () => ({
  recordView: recordViewMock,
  clearHistoryEntry: vi.fn(),
  clearAllHistory: vi.fn(),
}));

import {
  YOUTUBE_PLAYER_STATE,
  type YoutubeIframeApi,
  type YoutubeIframePlayer,
  type YoutubePlayerOptions,
} from "@/components/video/youtube-iframe-api";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

import { WatchPlayer } from "./watch-player";

const SNAPSHOT: VideoSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

interface FakePlayer extends YoutubeIframePlayer {
  readonly options: YoutubePlayerOptions;
}

/** Minimal fake `YT.Player`: records the options and lets the test emit events. */
function createFakeApi() {
  const players: FakePlayer[] = [];

  class Player implements FakePlayer {
    readonly options: YoutubePlayerOptions;
    readonly destroy = vi.fn();

    constructor(_element: HTMLElement, options: YoutubePlayerOptions) {
      this.options = options;
      players.push(this);
    }

    getIframe() {
      return document.createElement("iframe");
    }
  }

  const api: YoutubeIframeApi = { Player: Player as unknown as YoutubeIframeApi["Player"] };

  return { api, players };
}

function emitStateChange(player: FakePlayer, data: number) {
  player.options.events?.onStateChange?.({ target: player, data });
}

beforeEach(() => {
  loadYoutubeIframeApiMock.mockReset();
  recordViewMock.mockReset();
  recordViewMock.mockResolvedValue(undefined);
});

describe("WatchPlayer", () => {
  it("records the view snapshot only when playback starts", async () => {
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(<WatchPlayer snapshot={SNAPSHOT} />);

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => {
      player.options.events?.onReady?.({ target: player });
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PAUSED);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.BUFFERING);
    });

    // Page load and buffering never write a row.
    expect(recordViewMock).not.toHaveBeenCalled();

    act(() => {
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    await waitFor(() => expect(recordViewMock).toHaveBeenCalledTimes(1));

    // The action receives the stored projection, not the whole VideoDetail.
    expect(recordViewMock).toHaveBeenCalledWith({
      videoId: SNAPSHOT.videoId,
      title: SNAPSHOT.title,
      channelTitle: SNAPSHOT.channelTitle,
      thumbnailUrl: SNAPSHOT.thumbnailUrl,
      durationSeconds: SNAPSHOT.durationSeconds,
    });
    expect(recordViewMock.mock.calls[0]?.[0]).not.toHaveProperty("description");
    expect(recordViewMock.mock.calls[0]?.[0]).not.toHaveProperty("publishedAt");
  });

  it("records once even when the player re-enters PLAYING", async () => {
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(<WatchPlayer snapshot={SNAPSHOT} />);

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => {
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.BUFFERING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PAUSED);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    await waitFor(() => expect(recordViewMock).toHaveBeenCalledTimes(1));
  });

  it("keeps playback independent of a failed write", async () => {
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);
    recordViewMock.mockRejectedValue(new Error("database unavailable"));

    render(<WatchPlayer snapshot={SNAPSHOT} />);

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => {
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    await waitFor(() => expect(recordViewMock).toHaveBeenCalledTimes(1));
    // A rejection is swallowed; the component stays mounted and does not retry.
    act(() => {
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    expect(recordViewMock).toHaveBeenCalledTimes(1);
  });
});
