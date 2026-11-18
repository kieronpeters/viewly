import { describe, expect, it } from "vitest";

import {
  isEditableTarget,
  resolveWatchShortcut,
  type WatchShortcutKeyEvent,
} from "@/components/video/watch-shortcuts";

/**
 * Contract for `docs/specs/player-chrome.md`.
 *
 * Shortcut resolution is pure, so the whole mapping and every guard is asserted
 * without a DOM renderer. Theater/listen/mini-player persistence and the overlay
 * interaction are covered by their component suites and referenced in the
 * parity report.
 */
function press(key: string, overrides: Partial<WatchShortcutKeyEvent> = {}) {
  return resolveWatchShortcut({ key, target: document.body, ...overrides }, false);
}

describe("player chrome contract: shortcuts", () => {
  it("maps Space and K to play/pause", () => {
    expect(press(" ")).toEqual({ type: "play-pause" });
    expect(press("k")).toEqual({ type: "play-pause" });
    expect(press("K")).toEqual({ type: "play-pause" });
  });

  it("seeks ten seconds with J/L and five with the arrows", () => {
    expect(press("j")).toEqual({ type: "seek", deltaSeconds: -10 });
    expect(press("l")).toEqual({ type: "seek", deltaSeconds: 10 });
    expect(press("ArrowLeft")).toEqual({ type: "seek", deltaSeconds: -5 });
    expect(press("ArrowRight")).toEqual({ type: "seek", deltaSeconds: 5 });
  });

  it("changes volume in five-point steps and mutes with M", () => {
    expect(press("ArrowUp")).toEqual({ type: "volume", delta: 5 });
    expect(press("ArrowDown")).toEqual({ type: "volume", delta: -5 });
    expect(press("m")).toEqual({ type: "mute" });
  });

  it("maps the mode and help keys", () => {
    expect(press("f")).toEqual({ type: "fullscreen" });
    expect(press("t")).toEqual({ type: "theater" });
    expect(press("?")).toEqual({ type: "toggle-help" });
  });

  it("ignores editable targets so typing never seeks or pauses", () => {
    const input = document.createElement("input");

    expect(isEditableTarget(input)).toBe(true);
    expect(resolveWatchShortcut({ key: "k", target: input, ...{} }, false)).toBeNull();
  });

  it("ignores presses with modifier keys", () => {
    expect(press("k", { ctrlKey: true })).toBeNull();
    expect(press("k", { metaKey: true })).toBeNull();
  });
});
