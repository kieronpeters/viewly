import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
// The wrapper owns every write; the actions stay inert in jsdom.
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

import { ExpandableDescription } from "@/components/video/expandable-description";
import { PlayerSeekProvider } from "@/components/video/player-seek";
import {
  YOUTUBE_PLAYER_STATE,
  type YoutubeIframeApi,
  type YoutubeIframePlayer,
  type YoutubePlayerOptions,
} from "@/components/video/youtube-iframe-api";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

import { LISTEN_MODE_PREFERENCE_KEY } from "./listen-mode-preference";
import { WatchPlayerColumn } from "./watch-player-column";

const SNAPSHOT: VideoSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

interface FakePlayer extends YoutubeIframePlayer {
  readonly options: YoutubePlayerOptions;
  readonly playVideo: Mock<() => void>;
  readonly pauseVideo: Mock<() => void>;
  readonly seekTo: Mock<(seconds: number, allowSeekAhead?: boolean) => void>;
  readonly setVolume: Mock<(volume: number) => void>;
  readonly mute: Mock<() => void>;
  readonly unMute: Mock<() => void>;
  readonly destroy: Mock<() => void>;
  state: number;
  volume: number;
  muted: boolean;
  position: number;
}

/** Minimal fake `YT.Player` that also exposes the T86 controls. */
function createFakeApi() {
  const players: FakePlayer[] = [];

  class Player implements FakePlayer {
    readonly options: YoutubePlayerOptions;
    state: number = YOUTUBE_PLAYER_STATE.UNSTARTED;
    volume = 100;
    muted = false;
    position = 0;
    readonly destroy = vi.fn();
    readonly playVideo = vi.fn(() => {
      this.state = YOUTUBE_PLAYER_STATE.PLAYING;
    });
    readonly pauseVideo = vi.fn(() => {
      this.state = YOUTUBE_PLAYER_STATE.PAUSED;
    });
    readonly seekTo = vi.fn((seconds: number) => {
      this.position = seconds;
    });
    readonly setVolume = vi.fn((volume: number) => {
      this.volume = volume;
    });
    readonly mute = vi.fn(() => {
      this.muted = true;
    });
    readonly unMute = vi.fn(() => {
      this.muted = false;
    });

    constructor(_element: HTMLElement, options: YoutubePlayerOptions) {
      this.options = options;
      players.push(this);
    }

    getIframe() {
      return document.createElement("iframe");
    }

    getCurrentTime() {
      return this.position;
    }

    getDuration() {
      return SNAPSHOT.durationSeconds ?? 0;
    }

    getPlayerState() {
      return this.state;
    }

    getVolume() {
      return this.volume;
    }

    isMuted() {
      return this.muted;
    }
  }

  const api: YoutubeIframeApi = { Player: Player as unknown as YoutubeIframeApi["Player"] };

  return { api, players };
}

function emitReady(player: FakePlayer) {
  player.options.events?.onReady?.({ target: player });
}

function toggle(): HTMLElement {
  return screen.getByRole("switch", { name: "Listen mode" });
}

function renderColumn() {
  return render(
    <PlayerSeekProvider>
      <WatchPlayerColumn
        snapshot={SNAPSHOT}
        meta={
          <div data-slot="test-meta">
            <h1 id="watch-title">{SNAPSHOT.title}</h1>
            <p>{SNAPSHOT.channelTitle}</p>
            <p>Video actions</p>
          </div>
        }
      >
        <p>Show notes</p>
      </WatchPlayerColumn>
    </PlayerSeekProvider>,
  );
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

describe("listen mode toggle", () => {
  it("starts in the normal video layout with an unchecked switch", () => {
    renderColumn();

    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("region", { name: "Video player" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: SNAPSHOT.title })).toBeInTheDocument();
    expect(screen.getByText(SNAPSHOT.channelTitle)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="watch-listen-bar"]')).toBeNull();
    expect(document.querySelector('[data-slot="watch-meta"]')).not.toBeNull();
  });

  it("renders a compact audio bar and simplifies the page around it", async () => {
    const user = userEvent.setup();
    const { api } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderColumn();

    await user.click(toggle());

    // The page now announces an audio player, not a video player.
    expect(screen.getByRole("region", { name: "Audio player" })).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-checked", "true");

    const bar = screen.getByRole("group", { name: "Listen mode player" });
    expect(bar).toHaveAttribute("data-slot", "watch-listen-bar");

    // Artwork, title and channel come from the same snapshot as the page.
    expect(
      within(bar).getByRole("heading", { level: 1, name: SNAPSHOT.title }),
    ).toBeInTheDocument();
    expect(within(bar).getByText(SNAPSHOT.channelTitle)).toBeInTheDocument();
    expect(bar.querySelector("img")).not.toBeNull();

    // Basic controls are present and point at the official player.
    expect(within(bar).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(within(bar).getByRole("slider", { name: "Seek" })).toBeInTheDocument();
    expect(within(bar).getByRole("slider", { name: "Volume" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Show video" })).toBeInTheDocument();

    // The full meta block is gone, while the notes stay mounted.
    expect(document.querySelector('[data-slot="watch-meta"]')).toBeNull();
    expect(screen.getByText("Show notes")).toBeInTheDocument();
    // One heading only: the bar owns the page's h1.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("returns to the video layout from the bar", async () => {
    const user = userEvent.setup();
    const { api } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderColumn();

    await user.click(toggle());
    await user.click(screen.getByRole("button", { name: "Show video" }));

    expect(document.querySelector('[data-slot="watch-listen-bar"]')).toBeNull();
    expect(document.querySelector('[data-slot="watch-meta"]')).not.toBeNull();
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("region", { name: "Video player" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: SNAPSHOT.title })).toBeInTheDocument();
    // Focus returns to the switch in the video controls.
    expect(toggle()).toHaveFocus();
  });

  it("persists the preference locally and restores it on the next mount", async () => {
    const user = userEvent.setup();
    const { api } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    const { unmount } = renderColumn();

    await user.click(toggle());

    expect(window.localStorage.getItem(LISTEN_MODE_PREFERENCE_KEY)).toBe("true");

    unmount();
    renderColumn();

    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("region", { name: "Audio player" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="watch-listen-bar"]')).not.toBeNull();
  });

  it("is operable from the keyboard", async () => {
    const user = userEvent.setup();
    const { api } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderColumn();

    toggle().focus();
    await user.keyboard("{Enter}");

    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("group", { name: "Listen mode player" })).toBeInTheDocument();
    // Focus follows the switch into the layout that just appeared.
    expect(toggle()).toHaveFocus();
  });

  it("respects reduced motion in the switch and the bar", async () => {
    const user = userEvent.setup();

    renderColumn();

    expect(toggle()).toHaveClass("motion-reduce:transition-none");

    await user.click(toggle());

    const bar = screen.getByRole("group", { name: "Listen mode player" });
    expect(bar).toHaveClass("motion-reduce:transition-none");
  });
});

describe("listen mode player", () => {
  it("keeps exactly one official player across mode switches", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderColumn();

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    await user.click(toggle());
    await user.click(screen.getByRole("button", { name: "Show video" }));
    await user.click(toggle());

    // No second `YT.Player` was constructed, the original was not destroyed,
    // and the page still has a single iframe frame.
    expect(players).toHaveLength(1);
    expect(players[0]).toBe(player);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-slot="youtube-player-frame"]')).toHaveLength(1);
  });

  it("drives play, pause, seek and volume through the official player", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderColumn();

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => emitReady(player));
    await user.click(toggle());

    const bar = screen.getByRole("group", { name: "Listen mode player" });

    await user.click(within(bar).getByRole("button", { name: "Play" }));
    expect(player.playVideo).toHaveBeenCalledTimes(1);

    await user.click(within(bar).getByRole("button", { name: "Pause" }));
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);

    fireEvent.change(within(bar).getByRole("slider", { name: "Seek" }), {
      target: { value: "60" },
    });
    expect(player.seekTo).toHaveBeenCalledWith(60, true);

    fireEvent.change(within(bar).getByRole("slider", { name: "Volume" }), {
      target: { value: "35" },
    });
    expect(player.setVolume).toHaveBeenCalledWith(35);
  });

  it("keeps the T71 description seek channel working while listening", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    render(
      <PlayerSeekProvider>
        <WatchPlayerColumn snapshot={SNAPSHOT} meta={<h1 id="watch-title">{SNAPSHOT.title}</h1>}>
          <ExpandableDescription text={"0:00 Intro\n12:34 Demo"} />
        </WatchPlayerColumn>
      </PlayerSeekProvider>,
    );

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    act(() => emitReady(player));
    await user.click(toggle());
    await user.click(screen.getByRole("button", { name: "Seek to 12:34" }));

    expect(player.seekTo).toHaveBeenCalledWith(754, true);
  });

  it("disables the controls until the official player is ready", async () => {
    const user = userEvent.setup();

    // The loader stays pending, as a blocked third-party script would.
    loadYoutubeIframeApiMock.mockReturnValue(new Promise(() => {}));

    renderColumn();

    await user.click(toggle());

    const bar = screen.getByRole("group", { name: "Listen mode player" });

    expect(within(bar).getByRole("button", { name: "Play" })).toBeDisabled();
    expect(within(bar).getByRole("slider", { name: "Seek" })).toBeDisabled();
    expect(within(bar).getByRole("slider", { name: "Volume" })).toBeDisabled();
    // The way back to the video layout never depends on the embed.
    expect(within(bar).getByRole("button", { name: "Show video" })).toBeEnabled();
  });
});
