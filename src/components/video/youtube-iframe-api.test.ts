import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YOUTUBE_IFRAME_API_URL, type YoutubeIframeApi } from "./youtube-iframe-api";

const SCRIPT_SELECTOR = `script[src="${YOUTUBE_IFRAME_API_URL}"]`;

/**
 * Removes the globals and tags the loader owns. The jsdom document is shared by
 * every test in this file, and `vi.resetModules()` only clears module state, so
 * both have to be cleaned explicitly.
 */
function resetLoaderState() {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  document.querySelectorAll(SCRIPT_SELECTOR).forEach((script) => script.remove());
}

/** A minimal stand-in for `window.YT`; the loader only checks `Player`. */
function fakeApi(): YoutubeIframeApi {
  return { Player: class {} as unknown as YoutubeIframeApi["Player"] };
}

beforeEach(() => {
  vi.resetModules();
  resetLoaderState();
});

afterEach(() => {
  resetLoaderState();
});

describe("loadYoutubeIframeApi", () => {
  it("adds one script and resolves with window.YT when the API signals ready", async () => {
    const { loadYoutubeIframeApi } = await import("./youtube-iframe-api");

    const first = loadYoutubeIframeApi();
    const second = loadYoutubeIframeApi();

    // The shared promise is what keeps a page with two players from loading
    // the script (and running the API) twice.
    expect(second).toBe(first);
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);

    const api = fakeApi();
    window.YT = api;
    window.onYouTubeIframeAPIReady?.();

    await expect(first).resolves.toBe(api);
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
  });

  it("resolves immediately without a script when the API is already present", async () => {
    const api = fakeApi();
    window.YT = api;

    const { loadYoutubeIframeApi } = await import("./youtube-iframe-api");

    await expect(loadYoutubeIframeApi()).resolves.toBe(api);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  it("waits on an existing script instead of adding a second one", async () => {
    const existing = document.createElement("script");

    existing.src = YOUTUBE_IFRAME_API_URL;
    document.head.appendChild(existing);

    const { loadYoutubeIframeApi } = await import("./youtube-iframe-api");

    const pending = loadYoutubeIframeApi();

    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);

    const api = fakeApi();
    window.YT = api;
    window.onYouTubeIframeAPIReady?.();

    await expect(pending).resolves.toBe(api);
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
  });

  it("rejects when the script fails and retries with a fresh tag", async () => {
    const { loadYoutubeIframeApi } = await import("./youtube-iframe-api");

    const pending = loadYoutubeIframeApi();
    const script = document.querySelector(SCRIPT_SELECTOR);

    expect(script).not.toBeNull();
    script?.dispatchEvent(new Event("error"));

    await expect(pending).rejects.toThrow(/could not be loaded/i);
    // The failed tag is gone, so the retry does not reuse a dead script.
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();

    const retry = loadYoutubeIframeApi();
    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);

    const api = fakeApi();
    window.YT = api;
    window.onYouTubeIframeAPIReady?.();

    await expect(retry).resolves.toBe(api);
  });

  it("rejects when the script calls back without a Player constructor", async () => {
    const { loadYoutubeIframeApi } = await import("./youtube-iframe-api");

    const pending = loadYoutubeIframeApi();

    // A consent wall can serve a document that calls the global without YT.
    window.onYouTubeIframeAPIReady?.();

    await expect(pending).rejects.toThrow(/without a Player constructor/i);
  });

  it("rejects outside a browser instead of touching the DOM", async () => {
    const { loadYoutubeIframeApi } = await import("./youtube-iframe-api");

    vi.stubGlobal("window", undefined);

    try {
      await expect(loadYoutubeIframeApi()).rejects.toThrow(/only load in a browser/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
