import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { loadYoutubeIframeApiMock, recordViewMock, publishPlaybackEndedMock } = vi.hoisted(() => ({
  loadYoutubeIframeApiMock: vi.fn(),
  recordViewMock: vi.fn(),
  publishPlaybackEndedMock: vi.fn(),
}));

// jsdom cannot execute the real IFrame API, so the shared loader is replaced.
vi.mock("@/components/video/youtube-iframe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/video/youtube-iframe-api")>();

  return { ...actual, loadYoutubeIframeApi: loadYoutubeIframeApiMock };
});
// The wrapper owns the writes; both actions stay inert in jsdom.
vi.mock("@/features/library/history-actions", () => ({
  recordView: recordViewMock,
  clearHistoryEntry: vi.fn(),
  clearAllHistory: vi.fn(),
}));
vi.mock("@/components/video/playback-end", () => ({
  publishPlaybackEnded: publishPlaybackEndedMock,
}));

import { ExpandableDescription } from "@/components/video/expandable-description";
import { PlayerSeekProvider, usePlayerSeek } from "@/components/video/player-seek";
import type { PlayerClock } from "@/components/video/player-seek";
import {
  YOUTUBE_PLAYER_STATE,
  type YoutubeIframeApi,
  type YoutubeIframePlayer,
  type YoutubePlayerOptions,
} from "@/components/video/youtube-iframe-api";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

import { WatchChapters } from "./watch-chapters";
import { WatchPlayer } from "./watch-player";

const SNAPSHOT: VideoSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

const DESCRIPTION = "0:00 Intro\n12:34 Demo\n1:02:03 Encore";

interface FakePlayer extends YoutubeIframePlayer {
  readonly options: YoutubePlayerOptions;
  readonly seekTo: Mock<(seconds: number, allowSeekAhead?: boolean) => void>;
  readonly getCurrentTime: Mock<() => number>;
  readonly getDuration: Mock<() => number>;
}

/** Minimal fake `YT.Player`: records the options and every seek. */
function createFakeApi() {
  const players: FakePlayer[] = [];

  class Player implements FakePlayer {
    readonly options: YoutubePlayerOptions;
    readonly seekTo: Mock<(seconds: number, allowSeekAhead?: boolean) => void> = vi.fn();
    readonly getCurrentTime: Mock<() => number> = vi.fn(() => 83.5);
    readonly getDuration: Mock<() => number> = vi.fn(() => 213);

    constructor(_element: HTMLElement, options: YoutubePlayerOptions) {
      this.options = options;
      players.push(this);
    }

    getIframe() {
      return document.createElement("iframe");
    }

    destroy() {}
  }

  const api: YoutubeIframeApi = { Player: Player as unknown as YoutubeIframeApi["Player"] };

  return { api, players };
}

function emitReady(player: FakePlayer) {
  player.options.events?.onReady?.({ target: player });
}

function emitStateChange(player: FakePlayer, data: number) {
  player.options.events?.onStateChange?.({ target: player, data });
}

function renderWatchSurface() {
  return render(
    <PlayerSeekProvider>
      <WatchPlayer snapshot={SNAPSHOT} />
      <ExpandableDescription text={DESCRIPTION} />
      <WatchChapters text={DESCRIPTION} />
    </PlayerSeekProvider>,
  );
}

/** A button that samples the shared channel on demand, like the notes panel. */
function ClockProbe({ onRead }: { readonly onRead: (clock: PlayerClock | null) => void }) {
  const playerSeek = usePlayerSeek();

  return (
    <button type="button" onClick={() => onRead(playerSeek?.getPlaybackClock() ?? null)}>
      Read clock
    </button>
  );
}

beforeEach(() => {
  loadYoutubeIframeApiMock.mockReset();
  recordViewMock.mockReset();
  recordViewMock.mockResolvedValue(undefined);
  publishPlaybackEndedMock.mockReset();
});

describe("description timestamps seek the official player", () => {
  it("uses the T68 handle once the embed is ready", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderWatchSurface();

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => emitReady(player));

    await user.click(screen.getByRole("button", { name: "Seek to 12:34" }));

    expect(player.seekTo).toHaveBeenCalledWith(754, true);
  });

  it("remembers a chapter click made before the player is ready", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderWatchSurface();

    await waitFor(() => expect(players).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "1:02:03 Encore" }));

    const player = players[0];

    act(() => emitReady(player));

    expect(player.seekTo).toHaveBeenCalledWith(3_723, true);
  });

  it("does not record a view or start playback when only seeking", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderWatchSurface();

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => emitReady(player));
    await user.click(screen.getByRole("button", { name: "0:00 Intro" }));

    expect(player.seekTo).toHaveBeenCalledWith(0, true);
    expect(recordViewMock).not.toHaveBeenCalled();
    // Seeking is not playback: no PLAYING state was emitted by the player.
    expect(publishPlaybackEndedMock).not.toHaveBeenCalled();
    act(() => emitStateChange(player, YOUTUBE_PLAYER_STATE.PAUSED));
    expect(recordViewMock).not.toHaveBeenCalled();
  });
});

describe("the shared channel exposes the playhead for highlights", () => {
  it("reads the current position and duration from the official player", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);
    const clocks: Array<PlayerClock | null> = [];

    render(
      <PlayerSeekProvider>
        <WatchPlayer snapshot={SNAPSHOT} />
        <ClockProbe onRead={(clock) => clocks.push(clock)} />
      </PlayerSeekProvider>,
    );

    await waitFor(() => expect(players).toHaveLength(1));

    // Before the embed is ready there is nothing to anchor a highlight to.
    await user.click(screen.getByRole("button", { name: "Read clock" }));
    expect(clocks).toEqual([null]);

    act(() => emitReady(players[0]!));
    await user.click(screen.getByRole("button", { name: "Read clock" }));

    expect(clocks[1]).toEqual({ positionSeconds: 83.5, durationSeconds: 213 });
  });
});
