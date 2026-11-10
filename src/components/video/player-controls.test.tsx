import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerControls } from "./player-controls";

/**
 * jsdom implements neither the Fullscreen API nor its `fullscreenElement`
 * record, so each test installs only the properties it exercises on the real
 * document. Everything here is configurable, which lets the fixture be removed
 * again.
 */

let fullscreenElement: Element | null = null;

function setFullscreenElement(element: Element | null) {
  fullscreenElement = element;

  act(() => {
    document.dispatchEvent(new Event("fullscreenchange"));
  });
}

/** Renders the controls against a box the tests can prepare first. */
function renderControls(setup: (box: HTMLElement) => void = () => {}) {
  const box = document.createElement("div");

  setup(box);
  document.body.append(box);

  const result = render(<PlayerControls getContainer={() => box} />);

  return { ...result, box };
}

/** Makes `box` the document's fullscreen element and fires the event. */
function enterFullscreen(box: HTMLElement) {
  setFullscreenElement(box);
}

beforeEach(() => {
  fullscreenElement = null;

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
});

afterEach(() => {
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
});

describe("PlayerControls fullscreen", () => {
  it("renders a fullscreen control and no picture-in-picture control", () => {
    renderControls();

    const row = screen
      .getByRole("button", { name: "Fullscreen" })
      .closest('[data-slot="player-controls"]');

    expect(row).not.toBeNull();

    if (row === null) {
      throw new Error("Unreachable: the control row is missing.");
    }

    expect(within(row as HTMLElement).getByRole("button", { name: "Fullscreen" })).toBeVisible();
    expect(
      within(row as HTMLElement).queryByRole("button", { name: "Picture in picture" }),
    ).toBeNull();
  });

  it("exposes a labelled, focus-visible 44px toggle", () => {
    renderControls();

    const button = screen.getByRole("button", { name: "Fullscreen" });

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("aria-keyshortcuts", "f");
    // 44px on both axes, plus the Button focus ring.
    expect(button).toHaveClass("min-h-11", "min-w-11", "focus-visible:ring-3");
  });

  it("enters fullscreen on the reserved box and exits from the same button", async () => {
    const request = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.resolve());

    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      writable: true,
      value: exit,
    });

    const { box } = renderControls((element) => {
      Object.defineProperty(element, "requestFullscreen", {
        configurable: true,
        writable: true,
        value: request,
      });
    });

    const button = screen.getByRole("button", { name: "Fullscreen" });

    fireEvent.click(button);

    expect(request).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    enterFullscreen(box);

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    expect(button).toHaveAttribute("title", "Exit fullscreen (F)");

    fireEvent.click(button);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);

    setFullscreenElement(null);

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
    expect(button).toHaveAttribute("title", "Enter fullscreen (F)");
  });

  it("reflects fullscreen entered by the F shortcut or the browser", async () => {
    const { box } = renderControls();
    const button = screen.getByRole("button", { name: "Fullscreen" });

    enterFullscreen(box);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));

    setFullscreenElement(null);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("stays unpressed when the request is rejected", async () => {
    const { box } = renderControls((element) => {
      Object.defineProperty(element, "requestFullscreen", {
        configurable: true,
        writable: true,
        value: vi.fn(() => Promise.reject(new Error("Policy forbids fullscreen"))),
      });
    });

    const button = screen.getByRole("button", { name: "Fullscreen" });

    expect(() => fireEvent.click(button)).not.toThrow();

    await act(async () => {});

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(document.fullscreenElement).toBeNull();
    expect(box).not.toBeNull();
  });

  it("does not throw when the browser has no fullscreen API at all", () => {
    renderControls();

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }))).not.toThrow();
  });
});
