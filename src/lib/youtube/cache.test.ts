import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAX_ENTRIES,
  YOUTUBE_CACHE_DISABLED_ENV_VAR,
  YOUTUBE_CACHE_TTLS_MS,
  buildRequestCacheKey,
  createTtlCache,
  isYouTubeCacheDisabled,
} from "@/lib/youtube/cache";

/** A loader that resolves with a value and records every call. */
function countingLoader<T>(value: T): { load: () => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    load: async () => {
      calls += 1;
      return value;
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("buildRequestCacheKey", () => {
  it("sorts parameters and normalizes the query without the API key", () => {
    const key = buildRequestCacheKey("search", {
      type: "video",
      q: "  Rick   Astley ",
      part: "snippet",
      maxResults: "25",
      pageToken: undefined,
    });

    expect(key).toBe("search?maxResults=25&part=snippet&q=rick astley&type=video");
    expect(key).not.toContain("key=");
  });

  it("treats query casing and whitespace as the same search", () => {
    const first = buildRequestCacheKey("search", { q: "Never  Gonna Give" });
    const second = buildRequestCacheKey("search", { q: "never gonna give" });

    expect(first).toBe(second);
  });

  it("normalizes id batches so order and duplicates cannot split an entry", () => {
    const first = buildRequestCacheKey("videos", { id: "b,a,a" });
    const second = buildRequestCacheKey("videos", { id: "a,b" });

    expect(first).toBe(second);
    expect(first).toBe("videos?id=a,b");
  });

  it("keeps page tokens case-sensitive and endpoints separate", () => {
    expect(buildRequestCacheKey("search", { pageToken: "CAoQAA" })).not.toBe(
      buildRequestCacheKey("search", { pageToken: "caoqaa" }),
    );
    expect(buildRequestCacheKey("search", { q: "a" })).not.toBe(
      buildRequestCacheKey("videos", { q: "a" }),
    );
  });
});

describe("cache hits", () => {
  it("serves a second identical load from memory", async () => {
    const cache = createTtlCache();
    const loader = countingLoader({ items: 1 });

    const first = await cache.getOrLoad("k", 1_000, loader.load);
    const second = await cache.getOrLoad("k", 1_000, loader.load);

    expect(loader.calls()).toBe(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("keeps different keys separate", async () => {
    const cache = createTtlCache();
    const loader = countingLoader("value");

    await cache.getOrLoad("a", 1_000, loader.load);
    await cache.getOrLoad("b", 1_000, loader.load);

    expect(loader.calls()).toBe(2);
    expect(cache.size).toBe(2);
  });

  it("does not store entries for a non-positive TTL", async () => {
    const cache = createTtlCache();
    const loader = countingLoader("value");

    await cache.getOrLoad("k", 0, loader.load);
    await cache.getOrLoad("k", 0, loader.load);

    expect(loader.calls()).toBe(2);
    expect(cache.size).toBe(0);
  });
});

describe("TTL expiry", () => {
  it("refreshes an entry after its TTL, using fake timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const cache = createTtlCache();
    const loader = countingLoader("fresh");

    await cache.getOrLoad("k", YOUTUBE_CACHE_TTLS_MS.search, loader.load);
    await cache.getOrLoad("k", YOUTUBE_CACHE_TTLS_MS.search, loader.load);
    expect(loader.calls()).toBe(1);

    // One millisecond before the deadline: still served from cache.
    vi.setSystemTime(Date.now() + YOUTUBE_CACHE_TTLS_MS.search - 1);
    await cache.getOrLoad("k", YOUTUBE_CACHE_TTLS_MS.search, loader.load);
    expect(loader.calls()).toBe(1);

    // At the deadline the entry is dead and the next call goes upstream again.
    vi.setSystemTime(Date.now() + 1);
    await cache.getOrLoad("k", YOUTUBE_CACHE_TTLS_MS.search, loader.load);
    expect(loader.calls()).toBe(2);
  });

  it("drops an expired entry on read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const cache = createTtlCache();
    cache.set("k", "value", 1_000);

    vi.setSystemTime(Date.now() + 1_001);

    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe("request coalescing", () => {
  it("shares one load between concurrent callers", async () => {
    const cache = createTtlCache();
    let resolveLoad: ((value: string) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const first = cache.getOrLoad("k", 1_000, load);
    const second = cache.getOrLoad("k", 1_000, load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.pendingCount).toBe(1);

    resolveLoad?.("shared");

    await expect(Promise.all([first, second])).resolves.toEqual(["shared", "shared"]);
    expect(cache.pendingCount).toBe(0);
    expect(cache.size).toBe(1);
  });
});

describe("eviction", () => {
  it("never exceeds maxEntries and evicts the least recently used entry", async () => {
    const cache = createTtlCache({ maxEntries: 3 });
    const loader = countingLoader("value");

    await cache.getOrLoad("a", 60_000, loader.load);
    await cache.getOrLoad("b", 60_000, loader.load);
    await cache.getOrLoad("c", 60_000, loader.load);

    // Touch "a" so "b" becomes the least recently used entry.
    expect(cache.get("a")).toBe("value");

    await cache.getOrLoad("d", 60_000, loader.load);

    expect(cache.size).toBe(3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("value");
    expect(cache.get("c")).toBe("value");
    expect(cache.get("d")).toBe("value");
  });

  it("defaults to a finite bound", () => {
    const cache = createTtlCache();

    for (let index = 0; index < DEFAULT_MAX_ENTRIES + 10; index += 1) {
      cache.set(`k${index}`, index, 60_000);
    }

    expect(cache.size).toBe(DEFAULT_MAX_ENTRIES);
  });

  it("rejects a non-positive bound", () => {
    expect(() => createTtlCache({ maxEntries: 0 })).toThrow(RangeError);
  });
});

describe("errors", () => {
  it("does not cache a rejected load and retries upstream", async () => {
    const cache = createTtlCache();
    const failure = new Error("upstream failed");
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce("recovered");

    await expect(cache.getOrLoad("k", 60_000, load)).rejects.toBe(failure);

    expect(cache.size).toBe(0);
    expect(cache.pendingCount).toBe(0);

    await expect(cache.getOrLoad("k", 60_000, load)).resolves.toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("bypass", () => {
  it("treats only the documented values as disabled", () => {
    const disabled = ["1", "true", "TRUE", "yes", "on", " 1 "];
    for (const value of disabled) {
      expect(isYouTubeCacheDisabled({ [YOUTUBE_CACHE_DISABLED_ENV_VAR]: value })).toBe(true);
    }

    for (const value of ["", "0", "false", "no", "off", "anything"]) {
      expect(isYouTubeCacheDisabled({ [YOUTUBE_CACHE_DISABLED_ENV_VAR]: value })).toBe(false);
    }

    expect(isYouTubeCacheDisabled({})).toBe(false);
  });
});
