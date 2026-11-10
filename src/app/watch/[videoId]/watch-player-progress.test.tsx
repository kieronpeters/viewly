import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const {
  loadYoutubeIframeApiMock,
  recordViewMock,
  saveProgressMock,
  clearProgressMock,
  publishPlaybackEndedMock,
} = vi.hoisted(() => ({
  loadYoutubeIframeApiMock: vi.fn(),
  recordViewMock: vi.fn(),
  saveProgressMock: vi.fn(),
  clearProgressMock: vi.fn(),
  publishPlaybackEndedMock: vi.fn(),
}));

// jsdom cannot execute the real IFrame API, so the shared loader is replaced.
vi.mock("@/components/video/youtube-iframe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/video/youtube-iframe-api")>();

  return { ...actual, loadYoutubeIframeApi: loadYoutubeIframeApiMock };
});
// The wrapper owns every write; both action modules are inert spies in jsdom.
vi.mock("@/features/library/history-actions", () => ({
  recordView: recordViewMock,
  clearHistoryEntry: vi.fn(),
  clearAllHistory: vi.fn(),
}));
vi.mock("@/features/progress/actions", () => ({
  saveProgress: saveProgressMock,
  clearProgress: clearProgressMock,
}));
// The rail listens to this signal; the wrapper only has to publish it.
vi.mock("@/components/video/playback-end", () => ({
  publishPlaybackEnded: publishPlaybackEndedMock,
}));

import {
  YOUTUBE_PLAYER_STATE,
  type YoutubeIframeApi,
  type YoutubeIframePlayer,
  type YoutubePlayerOptions,
} from "@/components/video/youtube-iframe-api";
import type { VideoProgress } from "@/features/progress/progress";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

import { WatchPlayer } from "./watch-player";

const SNAPSHOT: VideoSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 200,
};

const PROGRESS: VideoProgress = {
  videoId: SNAPSHOT.videoId,
  positionSeconds: 60,
  durationSeconds: 200,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

interface FakePlayer extends YoutubeIframePlayer {
  readonly options: YoutubePlayerOptions;
  position: number;
  duration: number;
  readonly seekTo: Mock<(seconds: number, allowSeekAhead?: boolean) => void>;
}

/** Minimal fake `YT.Player`: records options, reports a clock, records seeks. */
function createFakeApi() {
  const players: FakePlayer[] = [];

  class Player implements FakePlayer {
    readonly options: YoutubePlayerOptions;
    position = 30;
    duration = 200;
    readonly seekTo: Mock<(seconds: number, allowSeekAhead?: boolean) => void> = vi.fn(
      (seconds: number) => {
        this.position = seconds;
      },
    );

    constructor(_element: HTMLElement, options: YoutubePlayerOptions) {
      this.options = options;
      players.push(this);
    }

    getIframe() {
      return document.createElement("iframe");
    }

    destroy() {}

    getCurrentTime() {
      return this.position;
    }

    getDuration() {
      return this.duration;
    }
  }

  const api: YoutubeIframeApi = { Player: Player as unknown as YoutubeIframeApi["Player"] };

  return { api, players };
}

function emitStateChange(player: FakePlayer, data: number) {
  player.options.events?.onStateChange?.({ target: player, data });
}

function emitReady(player: FakePlayer) {
  player.options.events?.onReady?.({ target: player });
}

/** Renders the wrapper and waits for the fake API to create one player. */
async function renderPlayer(initialProgress: VideoProgress | null = null) {
  const { api, players } = createFakeApi();
  loadYoutubeIframeApiMock.mockResolvedValue(api);

  render(<WatchPlayer snapshot={SNAPSHOT} initialProgress={initialProgress} />);

  await waitFor(() => expect(players).toHaveLength(1));

  return players[0];
}

beforeEach(() => {
  loadYoutubeIframeApiMock.mockReset();
  recordViewMock.mockReset();
  recordViewMock.mockResolvedValue(undefined);
  saveProgressMock.mockReset();
  saveProgressMock.mockResolvedValue(undefined);
  clearProgressMock.mockReset();
  clearProgressMock.mockResolvedValue(undefined);
  publishPlaybackEndedMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WatchPlayer progress reporting", () => {
  it("writes nothing before playback starts", async () => {
    await renderPlayer();
    vi.useFakeTimers();

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });

    expect(saveProgressMock).not.toHaveBeenCalled();
  });

  it("reports the position every five seconds while playing", async () => {
    const player = await renderPlayer();
    vi.useFakeTimers();

    act(() => {
      emitReady(player);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    expect(saveProgressMock).toHaveBeenCalledWith(SNAPSHOT.videoId, 30, 200);

    player.position = 35.8;

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(saveProgressMock).toHaveBeenCalledTimes(2);
    expect(saveProgressMock).toHaveBeenLastCalledWith(SNAPSHOT.videoId, 35.8, 200);
  });

  it("does not report a position under one second", async () => {
    const player = await renderPlayer();
    vi.useFakeTimers();
    player.position = 0.4;

    act(() => {
      emitReady(player);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(saveProgressMock).not.toHaveBeenCalled();
  });

  it("flushes one position on pause and stops the timer", async () => {
    const player = await renderPlayer();
    vi.useFakeTimers();
    player.position = 12.5;

    act(() => {
      emitReady(player);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PAUSED);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    expect(saveProgressMock).toHaveBeenCalledWith(SNAPSHOT.videoId, 12.5, 200);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });

    expect(saveProgressMock).toHaveBeenCalledTimes(1);
  });

  it("clears the stored position when playback ends", async () => {
    const player = await renderPlayer();

    act(() => {
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.ENDED);
    });

    await waitFor(() => expect(clearProgressMock).toHaveBeenCalledWith(SNAPSHOT.videoId));
    expect(publishPlaybackEndedMock).toHaveBeenCalledWith(SNAPSHOT.videoId);
  });

  it("keeps playing when a progress write fails", async () => {
    saveProgressMock.mockRejectedValue(new Error("database unavailable"));

    const player = await renderPlayer();
    vi.useFakeTimers();

    act(() => {
      emitReady(player);
      emitStateChange(player, YOUTUBE_PLAYER_STATE.PLAYING);
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(saveProgressMock).toHaveBeenCalledTimes(1);
    // The component is still mounted and keeps its timer.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(saveProgressMock).toHaveBeenCalledTimes(2);
  });
});

describe("WatchPlayer resume prompt", () => {
  it("shows the prompt between 5% and 95% and seeks on resume", async () => {
    const user = userEvent.setup();
    const player = await renderPlayer(PROGRESS);

    const resume = screen.getByRole("button", { name: "Resume from 1:00" });
    expect(screen.getByRole("group", { name: "Resume playback" })).toBeInTheDocument();

    act(() => emitReady(player));
    await user.click(resume);

    expect(player.seekTo).toHaveBeenCalledWith(60, true);
    expect(screen.queryByRole("group", { name: "Resume playback" })).not.toBeInTheDocument();
    expect(saveProgressMock).not.toHaveBeenCalled();
  });

  it("remembers a resume click made before the player is ready", async () => {
    const user = userEvent.setup();
    const player = await renderPlayer(PROGRESS);

    await user.click(screen.getByRole("button", { name: "Resume from 1:00" }));

    act(() => emitReady(player));

    expect(player.seekTo).toHaveBeenCalledWith(60, true);
  });

  it("clears progress and seeks to zero on start over", async () => {
    const user = userEvent.setup();
    const player = await renderPlayer(PROGRESS);

    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(clearProgressMock).toHaveBeenCalledWith(SNAPSHOT.videoId);
    expect(screen.queryByRole("group", { name: "Resume playback" })).not.toBeInTheDocument();

    act(() => emitReady(player));

    expect(player.seekTo).toHaveBeenCalledWith(0, true);
  });

  it.each([
    ["just started", 4, 200],
    ["effectively finished", 190, 200],
  ])("does not show a prompt for a %s video", async (_label, position, duration) => {
    await renderPlayer({ ...PROGRESS, positionSeconds: position, durationSeconds: duration });

    expect(screen.queryByRole("group", { name: "Resume playback" })).not.toBeInTheDocument();
  });

  it("does not show a prompt without saved progress", async () => {
    await renderPlayer(null);

    expect(screen.queryByRole("group", { name: "Resume playback" })).not.toBeInTheDocument();
  });
});
