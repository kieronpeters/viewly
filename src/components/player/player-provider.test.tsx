import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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
// The player still owns the history/progress writes; the actions stay inert.
vi.mock("@/features/library/history-actions", () => ({
  recordView: recordViewMock,
  clearHistoryEntry: vi.fn(),
  clearAllHistory: vi.fn(),
}));
vi.mock("@/features/progress/actions", () => ({
  saveProgress: saveProgressMock,
  clearProgress: clearProgressMock,
}));
vi.mock("@/components/video/playback-end", () => ({
  publishPlaybackEnded: publishPlaybackEndedMock,
}));

import { WatchPlayerColumn } from "@/app/watch/[videoId]/watch-player-column";
import { PlayerProvider } from "@/components/player/player-provider";
import { PlayerSeekProvider, usePlayerSeek } from "@/components/video/player-seek";
import {
  YOUTUBE_PLAYER_STATE,
  type YoutubeIframeApi,
  type YoutubeIframePlayer,
  type YoutubePlayerOptions,
} from "@/components/video/youtube-iframe-api";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

const SNAPSHOT: VideoSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

interface FakePlayer extends YoutubeIframePlayer {
  readonly options: YoutubePlayerOptions;
  readonly iframe: HTMLIFrameElement;
  readonly destroy: Mock<() => void>;
  readonly playVideo: Mock<() => void>;
  readonly pauseVideo: Mock<() => void>;
  readonly seekTo: Mock<(seconds: number, allowSeekAhead?: boolean) => void>;
  readonly getCurrentTime: Mock<() => number>;
  readonly getDuration: Mock<() => number>;
  readonly getPlayerState: Mock<() => number>;
  readonly getVolume: Mock<() => number>;
  readonly setVolume: Mock<(volume: number) => void>;
  readonly isMuted: Mock<() => boolean>;
  readonly mute: Mock<() => void>;
  readonly unMute: Mock<() => void>;
  state: number;
  position: number;
}

/** Minimal fake `YT.Player` that inserts a real iframe, like the API does. */
function createFakeApi() {
  const players: FakePlayer[] = [];

  class Player implements FakePlayer {
    readonly options: YoutubePlayerOptions;
    readonly iframe: HTMLIFrameElement;
    state: number = YOUTUBE_PLAYER_STATE.UNSTARTED;
    position = 0;
    readonly destroy = vi.fn(() => this.iframe.remove());
    readonly playVideo = vi.fn(() => {
      this.state = YOUTUBE_PLAYER_STATE.PLAYING;
    });
    readonly pauseVideo = vi.fn(() => {
      this.state = YOUTUBE_PLAYER_STATE.PAUSED;
    });
    readonly seekTo = vi.fn((seconds: number) => {
      this.position = seconds;
    });
    readonly getCurrentTime = vi.fn(() => this.position);
    readonly getDuration = vi.fn(() => SNAPSHOT.durationSeconds ?? 0);
    readonly getPlayerState = vi.fn(() => this.state);
    readonly getVolume = vi.fn(() => 100);
    readonly setVolume = vi.fn();
    readonly isMuted = vi.fn(() => false);
    readonly mute = vi.fn();
    readonly unMute = vi.fn();

    constructor(element: HTMLElement, options: YoutubePlayerOptions) {
      this.options = options;
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

function emitReady(player: FakePlayer) {
  act(() => {
    player.options.events?.onReady?.({ target: player });
  });
}

function emitPlaying(player: FakePlayer) {
  player.state = YOUTUBE_PLAYER_STATE.PLAYING;
  act(() => {
    player.options.events?.onStateChange?.({ target: player, data: YOUTUBE_PLAYER_STATE.PLAYING });
  });
}

/**
 * A watch route and a home route under one provider, so a test can navigate
 * between them exactly as the App Router would (the watch column unmounts).
 */
function ShellHarness() {
  const [route, setRoute] = useState<"watch" | "home">("watch");

  return (
    <PlayerSeekProvider>
      <PlayerProvider>
        <SeekProbe />
        {route === "watch" ? (
          <WatchPlayerColumn snapshot={SNAPSHOT} meta={<h1 id="watch-title">{SNAPSHOT.title}</h1>}>
            <button type="button" onClick={() => setRoute("home")}>
              Go home
            </button>
          </WatchPlayerColumn>
        ) : (
          <div>
            <h1>Home</h1>
            <button type="button" onClick={() => setRoute("watch")}>
              Go watch
            </button>
          </div>
        )}
      </PlayerProvider>
    </PlayerSeekProvider>
  );
}

/** Mirrors a description timestamp: it only knows the shared seek channel. */
function SeekProbe() {
  const playerSeek = usePlayerSeek();

  return (
    <button type="button" onClick={() => playerSeek?.seekTo(42)}>
      Seek via channel
    </button>
  );
}

/** Renders the shell, waits for the embed and reports the fake player. */
async function renderPlayingShell() {
  const { api, players } = createFakeApi();

  loadYoutubeIframeApiMock.mockResolvedValue(api);

  const view = render(<ShellHarness />);

  await waitFor(() => expect(players).toHaveLength(1));

  const player = players[0]!;

  emitReady(player);
  emitPlaying(player);

  return { ...view, player, players };
}

function miniPlayer(): HTMLElement {
  return screen.getByRole("region", { name: "Mini player" });
}

beforeEach(() => {
  window.localStorage.clear();
  loadYoutubeIframeApiMock.mockReset();
  recordViewMock.mockReset();
  recordViewMock.mockResolvedValue(undefined);
  saveProgressMock.mockReset();
  clearProgressMock.mockReset();
  publishPlaybackEndedMock.mockReset();
});

describe("shell player across a route change", () => {
  it("keeps the single embed alive and playing when the watch route unmounts", async () => {
    const user = userEvent.setup();
    const { player } = await renderPlayingShell();

    const iframe = player.iframe;

    // On the watch route the player is docked over the stage slot, not mini.
    expect(screen.getByRole("region", { name: "Video player" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="player-surface"]')).toHaveAttribute(
      "data-mode",
      "docked",
    );
    expect(screen.queryByRole("region", { name: "Mini player" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Go home" }));

    const mini = miniPlayer();

    // One instance, never destroyed, and the very same iframe is still mounted.
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.contains(iframe)).toBe(true);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-slot="youtube-player-frame"]')).toHaveLength(1);

    // The mini player still represents the same video.
    expect(within(mini).getByText(SNAPSHOT.title)).toBeInTheDocument();
    expect(within(mini).getByText(SNAPSHOT.channelTitle)).toBeInTheDocument();
    expect(within(mini).getByRole("link", { name: `Open ${SNAPSHOT.title}` })).toHaveAttribute(
      "href",
      `/watch/${SNAPSHOT.videoId}`,
    );
  });

  it("never constructs a second player when routing back and forth", async () => {
    const user = userEvent.setup();
    const { player, players } = await renderPlayingShell();

    const iframe = player.iframe;

    await user.click(screen.getByRole("button", { name: "Go home" }));
    await user.click(screen.getByRole("button", { name: "Go watch" }));
    await user.click(screen.getByRole("button", { name: "Go home" }));

    expect(players).toHaveLength(1);
    expect(players[0]).toBe(player);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.contains(iframe)).toBe(true);
  });

  it("keeps the shared seek channel pointed at the same player after a route change", async () => {
    const user = userEvent.setup();
    const { player } = await renderPlayingShell();

    await user.click(screen.getByRole("button", { name: "Seek via channel" }));

    expect(player.seekTo).toHaveBeenCalledWith(42, true);

    await user.click(screen.getByRole("button", { name: "Go home" }));
    await user.click(screen.getByRole("button", { name: "Seek via channel" }));

    expect(player.seekTo).toHaveBeenLastCalledWith(42, true);
  });

  it("mounts no player at all until a video is selected", () => {
    render(
      <PlayerProvider>
        <p>Nothing playing</p>
      </PlayerProvider>,
    );

    expect(loadYoutubeIframeApiMock).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("region", { name: "Mini player" })).toBeNull();
  });

  it("hides the mini player when playback never started", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();

    loadYoutubeIframeApiMock.mockResolvedValue(api);
    render(<ShellHarness />);

    await waitFor(() => expect(players).toHaveLength(1));
    emitReady(players[0]!);

    // A video that was opened but never played is not a session worth a surface.
    await user.click(screen.getByRole("button", { name: "Go home" }));

    expect(screen.queryByRole("region", { name: "Mini player" })).toBeNull();
  });
});

describe("mini player controls", () => {
  it("plays and pauses through the same official player", async () => {
    const user = userEvent.setup();
    const { player } = await renderPlayingShell();

    await user.click(screen.getByRole("button", { name: "Go home" }));

    const mini = miniPlayer();

    await user.click(within(mini).getByRole("button", { name: "Pause" }));
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);

    await user.click(within(mini).getByRole("button", { name: "Play" }));
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(player.playVideo).toHaveBeenCalledWith();
  });

  it("seeks and shows progress through the same official player", async () => {
    const user = userEvent.setup();
    const { player } = await renderPlayingShell();

    await user.click(screen.getByRole("button", { name: "Go home" }));

    const slider = within(miniPlayer()).getByRole("slider", { name: "Seek" });

    fireEvent.change(slider, { target: { value: "60" } });

    expect(player.seekTo).toHaveBeenCalledWith(60, true);
  });

  it("closes the mini player and releases the video", async () => {
    const user = userEvent.setup();
    const { player, players } = await renderPlayingShell();

    await user.click(screen.getByRole("button", { name: "Go home" }));
    await user.click(within(miniPlayer()).getByRole("button", { name: "Close mini player" }));

    expect(screen.queryByRole("region", { name: "Mini player" })).toBeNull();
    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(players).toHaveLength(1);
  });
});

describe("mini player accessibility and placement", () => {
  it("sits above the mobile bottom navigation and is not a dialog", async () => {
    const user = userEvent.setup();
    await renderPlayingShell();

    await user.click(screen.getByRole("button", { name: "Go home" }));

    const mini = miniPlayer();
    const surface = document.querySelector<HTMLElement>('[data-slot="player-surface"]');

    expect(surface).not.toBeNull();
    // Mobile: above the 3.5rem bar plus its safe-area padding; desktop: corner.
    expect(surface).toHaveClass("bottom-[calc(3.5rem_+_env(safe-area-inset-bottom)_+_0.75rem)]");
    expect(surface).toHaveClass("md:bottom-4", "right-3", "md:right-4");
    expect(mini).not.toHaveAttribute("aria-modal");
    expect(mini).not.toHaveAttribute("role", "dialog");
  });

  it("is keyboard reachable without trapping focus, and Escape leaves it open", async () => {
    const user = userEvent.setup();
    await renderPlayingShell();

    await user.click(screen.getByRole("button", { name: "Go home" }));

    const mini = miniPlayer();
    const close = within(mini).getByRole("button", { name: "Close mini player" });

    close.focus();
    expect(close).toHaveFocus();

    // Tab past the last control (the seek field) leaves the card.
    within(mini).getByRole("slider", { name: "Seek" }).focus();
    await user.tab();
    expect(mini.contains(document.activeElement)).toBe(false);

    // No global Escape handler: the card stays until it is closed explicitly.
    document.body.focus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Mini player" })).toBeInTheDocument();
  });

  it("respects reduced motion", async () => {
    const user = userEvent.setup();
    await renderPlayingShell();

    await user.click(screen.getByRole("button", { name: "Go home" }));

    expect(miniPlayer()).toHaveClass("motion-reduce:transition-none");
  });
});
