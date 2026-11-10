import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPlaybackEndedEvent,
  getPlaybackEndedEvent,
  publishPlaybackEnded,
  subscribeToPlaybackEnded,
} from "./playback-end";

beforeEach(() => {
  clearPlaybackEndedEvent();
});

describe("playback-end signal", () => {
  it("notifies subscribers and keeps the latest event", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPlaybackEnded(listener);

    publishPlaybackEnded("firstVideo1");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPlaybackEndedEvent()).toMatchObject({ videoId: "firstVideo1" });

    publishPlaybackEnded("secondVideo");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getPlaybackEndedEvent()).toMatchObject({ videoId: "secondVideo" });

    unsubscribe();

    publishPlaybackEnded("thirdVideo");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("uses a new sequence for every event", () => {
    publishPlaybackEnded("firstVideo1");
    const first = getPlaybackEndedEvent();

    publishPlaybackEnded("firstVideo1");
    const second = getPlaybackEndedEvent();

    expect(first?.sequence).not.toBe(second?.sequence);
    expect(second?.sequence).toBeGreaterThan(first?.sequence ?? 0);
  });

  it("clears only the matching event", () => {
    publishPlaybackEnded("firstVideo1");
    const first = getPlaybackEndedEvent();

    publishPlaybackEnded("secondVideo");
    const second = getPlaybackEndedEvent();

    if (second === null) {
      throw new Error("expected an event");
    }

    clearPlaybackEndedEvent(first ?? undefined);

    expect(getPlaybackEndedEvent()).toEqual(second);

    clearPlaybackEndedEvent(second);

    expect(getPlaybackEndedEvent()).toBeNull();
  });

  it("is a no-op when clearing an already consumed event", () => {
    publishPlaybackEnded("firstVideo1");
    const event = getPlaybackEndedEvent();

    if (event === null) {
      throw new Error("expected an event");
    }

    clearPlaybackEndedEvent(event);

    expect(() => clearPlaybackEndedEvent(event)).not.toThrow();
    expect(getPlaybackEndedEvent()).toBeNull();
  });
});
