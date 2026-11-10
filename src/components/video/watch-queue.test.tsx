import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import type { VideoSummary } from "@/shared/types";

import { setAutoplayPreference } from "./autoplay-preference";
import { clearPlaybackEndedEvent, publishPlaybackEnded } from "./playback-end";
import { subscribeToPauseRequests } from "./playback-pause";
import { UP_NEXT_COUNTDOWN_SECONDS } from "./up-next";
import { WatchQueue } from "./watch-queue";
import {
  addVideoToQueue,
  getWatchQueue,
  parseWatchQueue,
  resetWatchQueueCache,
  WATCH_QUEUE_STORAGE_KEY,
} from "./watch-queue-store";

const CURRENT_ID = "currentVid1";

/** 11-character ids, as YouTube returns them. */
function id(index: number): string {
  return `q${String(index).padStart(10, "0")}`;
}

function video(index: number, overrides: Partial<VideoSummary> = {}): VideoSummary {
  const videoId = id(index);

  return {
    id: videoId,
    title: `Video ${index}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
    ...overrides,
  };
}

function enqueue(...videos: VideoSummary[]): void {
  act(() => {
    for (const item of videos) {
      addVideoToQueue(item);
    }
  });
}

function renderQueue() {
  return render(<WatchQueue currentVideoId={CURRENT_ID} />);
}

function queueRows(): HTMLElement[] {
  const list = screen.getByRole("list", { name: "Queued videos" });

  return within(list).getAllByRole("listitem");
}

beforeEach(() => {
  pushMock.mockReset();
  window.localStorage.clear();
  resetWatchQueueCache();
  clearPlaybackEndedEvent();
  setAutoplayPreference(false);
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetWatchQueueCache();
  clearPlaybackEndedEvent();
});

describe("WatchQueue rendering", () => {
  it("shows an authored empty state with disabled destructive actions", () => {
    renderQueue();

    expect(screen.getByRole("heading", { name: "Queue" })).toBeInTheDocument();
    expect(screen.getByText("Your queue is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shuffle queue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear queue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start sleep timer" })).toBeInTheDocument();
  });

  it("renders stored queue items with 44px reorder and remove targets", () => {
    enqueue(video(1), video(2));

    renderQueue();

    expect(queueRows()).toHaveLength(2);
    expect(screen.getByRole("heading", { name: /Queue/ })).toHaveTextContent("(2)");

    const firstUp = screen.getByRole("button", { name: `Move ${video(1).title} up` });
    const firstDown = screen.getByRole("button", { name: `Move ${video(1).title} down` });
    const remove = screen.getByRole("button", { name: `Remove ${video(1).title} from queue` });

    expect(firstUp).toBeDisabled();
    expect(firstDown).toBeEnabled();

    for (const control of [firstUp, firstDown, remove]) {
      expect(control).toHaveClass("min-h-11", "min-w-11");
    }
  });

  it("removes an item and persists the result", async () => {
    const user = userEvent.setup();
    enqueue(video(1), video(2));

    renderQueue();

    await user.click(screen.getByRole("button", { name: `Remove ${video(1).title} from queue` }));

    expect(queueRows()).toHaveLength(1);
    expect(screen.queryByText(video(1).title)).not.toBeInTheDocument();
    expect(parseWatchQueue(window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY))).toHaveLength(1);
  });

  it("clears the queue", async () => {
    const user = userEvent.setup();
    enqueue(video(1), video(2));

    renderQueue();
    await user.click(screen.getByRole("button", { name: "Clear queue" }));

    expect(screen.getByText("Your queue is empty")).toBeInTheDocument();
    expect(getWatchQueue()).toEqual([]);
  });

  it("keeps the queue across a remount using stored summaries", () => {
    enqueue(video(1), video(2));

    const first = renderQueue();

    expect(queueRows()).toHaveLength(2);

    first.unmount();
    resetWatchQueueCache();
    renderQueue();

    expect(queueRows()).toHaveLength(2);
    expect(screen.getByText(video(2).title)).toBeInTheDocument();
  });
});

describe("WatchQueue reordering", () => {
  it("moves items with the keyboard-accessible Up and Down buttons", async () => {
    const user = userEvent.setup();
    enqueue(video(1), video(2), video(3));

    renderQueue();

    const moveUp = screen.getByRole("button", { name: `Move ${video(3).title} up` });

    moveUp.focus();
    expect(moveUp).toHaveFocus();

    // Enter activates the focused button exactly as a pointer click would.
    await user.keyboard("{Enter}");

    expect(within(queueRows()[1] as HTMLElement).getByText(video(3).title)).toBeInTheDocument();
    expect(getWatchQueue().map((item) => item.id)).toEqual([id(1), id(3), id(2)]);

    await user.click(screen.getByRole("button", { name: `Move ${video(1).title} down` }));

    expect(getWatchQueue().map((item) => item.id)).toEqual([id(3), id(1), id(2)]);
  });

  it("reorders by drag and drop", () => {
    enqueue(video(1), video(2), video(3));

    renderQueue();

    const handles = screen.getAllByTitle("Drag to reorder");
    const rows = queueRows();
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    };

    fireEvent.dragStart(handles[0] as HTMLElement, { dataTransfer });
    fireEvent.dragOver(rows[2] as HTMLElement, { dataTransfer });
    fireEvent.drop(rows[2] as HTMLElement, { dataTransfer });

    expect(getWatchQueue().map((item) => item.id)).toEqual([id(2), id(3), id(1)]);
  });

  it("shuffles without losing items", async () => {
    const user = userEvent.setup();
    enqueue(video(1), video(2), video(3));
    vi.spyOn(Math, "random").mockReturnValue(0);

    renderQueue();
    await user.click(screen.getByRole("button", { name: "Shuffle queue" }));

    // Fisher-Yates with a constant zero: [1,2,3] -> [2,3,1].
    expect(getWatchQueue().map((item) => item.id)).toEqual([id(2), id(3), id(1)]);
    expect(queueRows()).toHaveLength(3);
  });
});

describe("WatchQueue sleep timer", () => {
  it("pauses playback after the chosen duration", () => {
    vi.useFakeTimers();

    const pauseListener = vi.fn();
    const unsubscribe = subscribeToPauseRequests(pauseListener);

    try {
      renderQueue();

      fireEvent.change(screen.getByLabelText("Pause after"), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: "Start sleep timer" }));

      expect(screen.getByRole("timer")).toHaveTextContent("Pausing in 5:00");
      expect(screen.getByRole("button", { name: "Cancel sleep timer" })).toHaveClass("min-h-11");

      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });

      expect(pauseListener).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("timer")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Sleep timer paused playback.");
    } finally {
      unsubscribe();
    }
  });

  it("cancels without pausing", () => {
    vi.useFakeTimers();

    const pauseListener = vi.fn();
    const unsubscribe = subscribeToPauseRequests(pauseListener);

    try {
      renderQueue();

      fireEvent.click(screen.getByRole("button", { name: "Start sleep timer" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel sleep timer" }));

      expect(screen.getByRole("status")).toHaveTextContent("Sleep timer cancelled.");

      act(() => {
        vi.advanceTimersByTime(60 * 60_000);
      });

      expect(pauseListener).not.toHaveBeenCalled();
      expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    } finally {
      unsubscribe();
    }
  });
});

describe("WatchQueue autoplay", () => {
  it("uses the existing T69 preference and starts the first queued video", () => {
    vi.useFakeTimers();
    enqueue(video(1), video(2));
    setAutoplayPreference(true);

    renderQueue();

    act(() => publishPlaybackEnded(CURRENT_ID));

    expect(screen.getByRole("progressbar", { name: "Queue autoplay countdown" })).toHaveAttribute(
      "aria-valuenow",
      `${UP_NEXT_COUNTDOWN_SECONDS}`,
    );
    expect(screen.getByText(/Playing next in/)).toHaveTextContent(video(1).title);

    act(() => {
      vi.advanceTimersByTime(UP_NEXT_COUNTDOWN_SECONDS * 1000);
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(`/watch/${id(1)}`);
    // The played item leaves the queue; the rest stays for the next hand-off.
    expect(getWatchQueue().map((item) => item.id)).toEqual([id(2)]);
  });

  it("does nothing when autoplay is off", () => {
    vi.useFakeTimers();
    enqueue(video(1));

    renderQueue();

    act(() => publishPlaybackEnded(CURRENT_ID));

    expect(
      screen.queryByRole("progressbar", { name: "Queue autoplay countdown" }),
    ).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("leaves the event for Up next when the queue is empty", () => {
    renderQueue();

    act(() => publishPlaybackEnded(CURRENT_ID));

    // The store still holds the event for VideoSuggestions to consume.
    expect(screen.queryByRole("progressbar", { name: "Queue autoplay countdown" })).toBeNull();
  });

  it("cancels the countdown with Escape and the Cancel button", () => {
    vi.useFakeTimers();
    enqueue(video(1), video(2));
    setAutoplayPreference(true);

    renderQueue();
    act(() => publishPlaybackEnded(CURRENT_ID));

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(
      screen.queryByRole("progressbar", { name: "Queue autoplay countdown" }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(UP_NEXT_COUNTDOWN_SECONDS * 1000);
    });
    expect(pushMock).not.toHaveBeenCalled();

    act(() => publishPlaybackEnded(CURRENT_ID));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("progressbar", { name: "Queue autoplay countdown" }),
    ).not.toBeInTheDocument();
  });

  it("respects the reduced-motion contract on the countdown bar", () => {
    vi.useFakeTimers();
    enqueue(video(1));
    setAutoplayPreference(true);

    renderQueue();
    act(() => publishPlaybackEnded(CURRENT_ID));

    const progress = screen.getByRole("progressbar", { name: "Queue autoplay countdown" });

    expect(progress.firstElementChild).toHaveClass("motion-reduce:transition-none");
  });
});
