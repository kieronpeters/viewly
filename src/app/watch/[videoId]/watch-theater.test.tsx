import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { loadYoutubeIframeApiMock, recordViewMock, saveProgressMock, clearProgressMock } =
  vi.hoisted(() => ({
    loadYoutubeIframeApiMock: vi.fn(),
    recordViewMock: vi.fn(),
    saveProgressMock: vi.fn(),
    clearProgressMock: vi.fn(),
  }));

// jsdom cannot execute the real IFrame API, so the shared loader is replaced.
vi.mock("@/components/video/youtube-iframe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/video/youtube-iframe-api")>();

  return { ...actual, loadYoutubeIframeApi: loadYoutubeIframeApiMock };
});
vi.mock("@/features/library/history-actions", () => ({
  recordView: recordViewMock,
  clearHistoryEntry: vi.fn(),
  clearAllHistory: vi.fn(),
}));
vi.mock("@/features/progress/actions", () => ({
  saveProgress: saveProgressMock,
  clearProgress: clearProgressMock,
}));

import { PlayerSeekProvider } from "@/components/video/player-seek";
import type {
  YoutubeIframeApi,
  YoutubeIframePlayer,
  YoutubePlayerOptions,
} from "@/components/video/youtube-iframe-api";
import type { VideoSnapshot } from "@/features/library/video-snapshot";

import { THEATER_PREFERENCE_KEY } from "./theater-preference";
import { WatchPlayerColumn } from "./watch-player-column";
import { WatchStageLayout } from "./watch-stage-layout";
import { WatchTheaterProvider } from "./watch-theater";

const SNAPSHOT: VideoSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

const NORMAL_GRID_CLASSES = [
  "lg:grid-cols-[minmax(0,1fr)_20rem]",
  "xl:grid-cols-[minmax(0,1fr)_22.5rem]",
];

interface FakePlayer extends YoutubeIframePlayer {
  readonly options: YoutubePlayerOptions;
  readonly destroy: Mock<() => void>;
}

/** Minimal fake `YT.Player`; the tests only need construction/destroy counts. */
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

function renderWatch() {
  return render(
    <WatchTheaterProvider>
      <WatchStageLayout rail={<p>Up next content</p>}>
        <PlayerSeekProvider>
          <WatchPlayerColumn
            snapshot={SNAPSHOT}
            meta={
              <>
                <h1 id="watch-title">{SNAPSHOT.title}</h1>
                <p>{SNAPSHOT.channelTitle}</p>
              </>
            }
          >
            <p>Details</p>
          </WatchPlayerColumn>
        </PlayerSeekProvider>
      </WatchStageLayout>
    </WatchTheaterProvider>,
  );
}

function theaterToggle(): HTMLElement {
  return screen.getByRole("button", { name: "Theater" });
}

function stageLayout(): HTMLElement {
  const layout = document.querySelector<HTMLElement>('[data-slot="watch-stage-layout"]');

  if (layout === null) {
    throw new Error("Unreachable: the stage layout is missing.");
  }

  return layout;
}

function rail(): HTMLElement {
  return screen.getByRole("complementary", { name: "Suggested videos" });
}

function pressT(): void {
  fireEvent.keyDown(document.body, { key: "t" });
}

beforeEach(() => {
  window.localStorage.clear();
  loadYoutubeIframeApiMock.mockReset();
  // Keep the API pending by default, as a blocked third-party script would.
  loadYoutubeIframeApiMock.mockReturnValue(new Promise(() => {}));
  recordViewMock.mockReset();
  recordViewMock.mockResolvedValue(undefined);
  saveProgressMock.mockReset();
  clearProgressMock.mockReset();
});

describe("theater mode", () => {
  it("starts in the normal two-column layout with an unpressed toggle", () => {
    renderWatch();

    const toggle = theaterToggle();

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveClass("min-h-11", "min-w-11");
    expect(toggle).toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring");
    expect(stageLayout()).toHaveAttribute("data-theater", "false");
    expect(stageLayout()).toHaveClass(...NORMAL_GRID_CLASSES);
    expect(rail()).not.toHaveClass("lg:hidden");
  });

  it("widens the player column and hides the rail from the visible control", async () => {
    const user = userEvent.setup();

    renderWatch();

    await user.click(theaterToggle());

    expect(theaterToggle()).toHaveAttribute("aria-pressed", "true");
    expect(stageLayout()).toHaveAttribute("data-theater", "true");
    expect(stageLayout()).toHaveClass("lg:grid-cols-1");
    expect(stageLayout()).not.toHaveClass(...NORMAL_GRID_CLASSES);
    expect(rail()).toHaveClass("lg:hidden");

    await user.click(theaterToggle());

    expect(theaterToggle()).toHaveAttribute("aria-pressed", "false");
    expect(stageLayout()).toHaveClass(...NORMAL_GRID_CLASSES);
    expect(rail()).not.toHaveClass("lg:hidden");
  });

  it("shares one state between the visible control and the T shortcut", () => {
    renderWatch();

    pressT();

    expect(theaterToggle()).toHaveAttribute("aria-pressed", "true");
    expect(rail()).toHaveClass("lg:hidden");

    fireEvent.click(theaterToggle());

    expect(theaterToggle()).toHaveAttribute("aria-pressed", "false");
    expect(rail()).not.toHaveClass("lg:hidden");
  });

  it("is operable from the keyboard with Enter", async () => {
    const user = userEvent.setup();

    renderWatch();

    theaterToggle().focus();
    await user.keyboard("{Enter}");

    expect(theaterToggle()).toHaveAttribute("aria-pressed", "true");
    expect(theaterToggle()).toHaveFocus();
  });

  it("persists the preference locally and restores it on the next mount", async () => {
    const user = userEvent.setup();

    const { unmount } = renderWatch();

    await user.click(theaterToggle());

    expect(window.localStorage.getItem(THEATER_PREFERENCE_KEY)).toBe("true");

    unmount();
    renderWatch();

    expect(theaterToggle()).toHaveAttribute("aria-pressed", "true");
    expect(stageLayout()).toHaveClass("lg:grid-cols-1");
    expect(rail()).toHaveClass("lg:hidden");
  });

  it("respects reduced motion on the toggle", () => {
    renderWatch();

    expect(theaterToggle()).toHaveClass("motion-reduce:transition-none");
  });

  it("keeps listen mode and the single official player intact while toggling", async () => {
    const user = userEvent.setup();
    const { api, players } = createFakeApi();

    loadYoutubeIframeApiMock.mockReset();
    loadYoutubeIframeApiMock.mockResolvedValue(api);

    renderWatch();

    await waitFor(() => expect(players).toHaveLength(1));

    const player = players[0];

    await user.click(screen.getByRole("switch", { name: "Listen mode" }));

    expect(screen.getByRole("group", { name: "Listen mode player" })).toBeInTheDocument();
    // Theater is still reachable while the compact bar replaces the stage.
    expect(theaterToggle()).toBeInTheDocument();

    pressT();

    expect(theaterToggle()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Listen mode player" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="watch-listen-bar"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-slot="youtube-player-frame"]')).toHaveLength(1);
    expect(players).toHaveLength(1);
    expect(players[0]).toBe(player);
    expect(player.destroy).not.toHaveBeenCalled();
  });
});

describe("ambient backdrop", () => {
  it("is a decorative, non-interactive reuse of the stored thumbnail", () => {
    renderWatch();

    const ambient = document.querySelector<HTMLElement>('[data-slot="watch-ambient-backdrop"]');

    expect(ambient).not.toBeNull();

    if (ambient === null) {
      throw new Error("Unreachable: the ambient backdrop is missing.");
    }

    expect(ambient).toHaveAttribute("aria-hidden", "true");
    expect(ambient).toHaveClass("pointer-events-none", "absolute", "-z-10");

    const image = ambient.querySelector("img");

    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", SNAPSHOT.thumbnailUrl);
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveClass("blur-3xl", "opacity-30", "object-cover");
  });
});
