import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

// The rail navigates with the App Router; no real router exists under Vitest.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import type { VideoSummary } from "@/shared/types";

import { AUTOPLAY_PREFERENCE_KEY, readAutoplayPreference } from "./autoplay-preference";
import { clearPlaybackEndedEvent, publishPlaybackEnded } from "./playback-end";
import { selectUpNextVideo, UP_NEXT_COUNTDOWN_SECONDS } from "./up-next";
import { VideoSuggestions } from "./video-suggestions";

const CURRENT_ID = "currentVid1";
const NEXT_ID = "aaaaaaaaaaa";
const OTHER_ID = "bbbbbbbbbbb";

/** Hand-written fixture shaped like a normalized `search.list` item. */
function video(id: string, overrides: Partial<VideoSummary> = {}): VideoSummary {
  return {
    id,
    title: `Video ${id}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
    ...overrides,
  };
}

const NEXT_VIDEO = video(NEXT_ID);
const OTHER_VIDEO = video(OTHER_ID);

function renderRail(videos: readonly VideoSummary[] = [NEXT_VIDEO, OTHER_VIDEO]) {
  return render(<VideoSuggestions videos={videos} currentVideoId={CURRENT_ID} />);
}

function autoplaySwitch() {
  return screen.getByRole("switch", { name: "Autoplay next video" });
}

function countdown() {
  return screen.queryByRole("progressbar", { name: "Autoplay countdown" });
}

/** Starts a countdown with the preference already on. */
function startCountdown() {
  fireEvent.click(autoplaySwitch());
  act(() => publishPlaybackEnded(CURRENT_ID));
}

beforeEach(() => {
  pushMock.mockReset();
  window.localStorage.clear();
  clearPlaybackEndedEvent();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  clearPlaybackEndedEvent();
});

describe("VideoSuggestions up next selection", () => {
  it("selects the first suggestion that is not the current video", () => {
    expect(selectUpNextVideo([video(CURRENT_ID), NEXT_VIDEO], CURRENT_ID)?.id).toBe(NEXT_ID);

    const onlyCurrent = [video(CURRENT_ID)];

    expect(selectUpNextVideo(onlyCurrent, CURRENT_ID)).toBeNull();
  });

  it("highlights the next suggestion and only that row", () => {
    renderRail();

    const section = screen.getByRole("region", { name: "Up next" });
    const links = within(section).getAllByRole("link");

    expect(links[0]).toHaveAttribute("href", `/watch/${NEXT_ID}`);
    expect(links[0]).toHaveAttribute("data-next", "true");
    expect(within(links[0]).getByText("Up next")).toBeInTheDocument();
    expect(links[0]).toHaveClass("ring-1", "ring-primary/50");

    expect(links[1]).not.toHaveAttribute("data-next");
    expect(within(links[1]).queryByText("Up next")).toBeNull();
  });

  it("never offers the current video even if it reaches the rail", () => {
    renderRail([video(CURRENT_ID), NEXT_VIDEO]);

    const firstRow = screen.getByRole("link", { name: `${NEXT_VIDEO.title} — up next` });

    expect(firstRow).toHaveAttribute("data-next", "true");
    expect(screen.queryByRole("link", { name: `${video(CURRENT_ID).title} — up next` })).toBeNull();
  });
});

describe("VideoSuggestions autoplay countdown", () => {
  it("defaults autoplay off and does nothing when playback ends", () => {
    vi.useFakeTimers();
    renderRail();

    expect(autoplaySwitch()).toHaveAttribute("aria-checked", "false");
    expect(readAutoplayPreference()).toBe(false);

    act(() => publishPlaybackEnded(CURRENT_ID));
    act(() => vi.advanceTimersByTime(UP_NEXT_COUNTDOWN_SECONDS * 1000));

    expect(countdown()).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("starts a five-second countdown when autoplay is on and then navigates", () => {
    vi.useFakeTimers();
    renderRail();

    startCountdown();

    expect(autoplaySwitch()).toHaveAttribute("aria-checked", "true");
    expect(countdown()).toHaveAttribute("aria-valuenow", `${UP_NEXT_COUNTDOWN_SECONDS}`);
    expect(screen.getByText(/up next in 5s/i)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(UP_NEXT_COUNTDOWN_SECONDS * 1000));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(`/watch/${NEXT_ID}`);
  });

  it("cancels the countdown and prevents navigation", () => {
    vi.useFakeTimers();
    renderRail();
    startCountdown();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(countdown()).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(UP_NEXT_COUNTDOWN_SECONDS * 1000));

    expect(pushMock).not.toHaveBeenCalled();
  });

  it("cancels from the keyboard with Escape", async () => {
    const user = userEvent.setup();
    renderRail();
    startCountdown();

    screen.getByRole("button", { name: "Cancel" }).focus();
    await user.keyboard("{Escape}");

    expect(countdown()).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("skips immediately without waiting for the countdown", () => {
    renderRail();
    startCountdown();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(`/watch/${NEXT_ID}`);
    expect(countdown()).toBeNull();
  });

  it("does not start a countdown without another video to play", () => {
    renderRail([video(CURRENT_ID)]);
    fireEvent.click(autoplaySwitch());
    act(() => publishPlaybackEnded(CURRENT_ID));

    expect(countdown()).toBeNull();
  });

  it("matches the reduced-motion contract on the progress bar", () => {
    renderRail();
    startCountdown();

    const progress = countdown();
    const bar = progress?.firstElementChild;

    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("motion-reduce:transition-none");
  });
});

describe("VideoSuggestions autoplay preference", () => {
  it("persists the choice in local storage across mounts", () => {
    const first = renderRail();

    fireEvent.click(autoplaySwitch());

    expect(window.localStorage.getItem(AUTOPLAY_PREFERENCE_KEY)).toBe("true");

    first.unmount();

    renderRail();

    expect(autoplaySwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("persists turning autoplay back off", () => {
    const first = renderRail();

    fireEvent.click(autoplaySwitch());
    fireEvent.click(autoplaySwitch());

    expect(window.localStorage.getItem(AUTOPLAY_PREFERENCE_KEY)).toBe("false");

    first.unmount();

    renderRail();

    expect(autoplaySwitch()).toHaveAttribute("aria-checked", "false");
  });
});
