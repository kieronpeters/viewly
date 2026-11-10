import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerControls } from "./player-controls";

/**
 * jsdom implements neither the Fullscreen nor the Picture-in-Picture API, so
 * each test installs only the properties it exercises on the real document.
 * Everything here is configurable, which lets the fixture be removed again.
 */

let fullscreenElement: Element | null = null;

function setFullscreenElement(element: Element | null) {
  fullscreenElement = element;

  act(() => {
    document.dispatchEvent(new Event("fullscreenchange"));
  });
}

function enablePictureInPicture(enabled: boolean) {
  Object.defineProperty(document, "pictureInPictureEnabled", {
    configurable: true,
    get: () => enabled,
  });
}

/** A video element the browser is allowed to put in a PiP window. */
function createVideo(request: () => Promise<void> = () => Promise.resolve()): HTMLVideoElement {
  const video = document.createElement("video");

  Object.defineProperty(video, "requestPictureInPicture", {
    configurable: true,
    writable: true,
    value: vi.fn(request),
  });

  return video;
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
  delete (document as { pictureInPictureEnabled?: unknown }).pictureInPictureEnabled;
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  delete (document as { pictureInPictureElement?: unknown }).pictureInPictureElement;
});

describe("PlayerControls fullscreen", () => {
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

describe("PlayerControls picture-in-picture", () => {
  it("hides the control when the browser has no PiP API", () => {
    enablePictureInPicture(false);
    renderControls((box) => box.append(createVideo()));

    expect(screen.queryByRole("button", { name: "Picture in picture" })).toBeNull();
  });

  it("hides the control when the surface exposes no media element", () => {
    // The official YouTube embed is a cross-origin iframe: nothing inside it
    // is reachable, so there is no element to hand to the PiP API.
    enablePictureInPicture(true);
    renderControls((box) => box.append(document.createElement("iframe")));

    expect(screen.queryByRole("button", { name: "Picture in picture" })).toBeNull();
  });

  it("requests PiP and reflects the active state", async () => {
    enablePictureInPicture(true);

    const videos: HTMLVideoElement[] = [];
    const request = vi.fn(() => Promise.resolve());

    renderControls((box) => {
      const video = createVideo(request);

      videos.push(video);
      box.append(video);
    });

    const button = screen.getByRole("button", { name: "Picture in picture" });

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveClass("min-h-11", "min-w-11");

    fireEvent.click(button);

    expect(request).toHaveBeenCalledTimes(1);

    act(() => {
      videos[0]?.dispatchEvent(new Event("enterpictureinpicture"));
    });

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));

    act(() => {
      videos[0]?.dispatchEvent(new Event("leavepictureinpicture"));
    });

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("exits PiP through the same button when it is already active", () => {
    enablePictureInPicture(true);

    const video = createVideo();
    const exit = vi.fn(() => Promise.resolve());

    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      get: () => video,
    });

    Object.defineProperty(document, "exitPictureInPicture", {
      configurable: true,
      writable: true,
      value: exit,
    });

    renderControls((box) => box.append(video));

    fireEvent.click(screen.getByRole("button", { name: "Picture in picture" }));

    expect(exit).toHaveBeenCalledTimes(1);
    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
  });

  it("handles a rejected PiP request without crashing or pressing the button", async () => {
    enablePictureInPicture(true);

    const videos: HTMLVideoElement[] = [];

    renderControls((box) => {
      const video = createVideo(() => Promise.reject(new Error("PiP is not allowed here")));

      videos.push(video);
      box.append(video);
    });

    const button = screen.getByRole("button", { name: "Picture in picture" });

    expect(() => fireEvent.click(button)).not.toThrow();

    // The rejection is consumed by the component, so no unhandled rejection
    // fails the test run and the control stays in its idle state.
    await act(async () => {});

    expect(videos[0]?.requestPictureInPicture).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("handles a synchronous PiP throw", () => {
    enablePictureInPicture(true);

    renderControls((box) => {
      const video = document.createElement("video");

      Object.defineProperty(video, "requestPictureInPicture", {
        configurable: true,
        value: () => {
          throw new Error("NotAllowedError");
        },
      });

      box.append(video);
    });

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Picture in picture" })),
    ).not.toThrow();
  });
});
