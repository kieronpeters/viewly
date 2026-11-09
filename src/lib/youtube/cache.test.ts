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

describe("TTL boundary", () => {
  it("expires exactly at the deadline, not one millisecond later", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const cache = createTtlCache();
    cache.set("k", "value", 1_000);

    vi.setSystemTime(Date.now() + 999);
    expect(cache.get("k")).toBe("value");

    vi.setSystemTime(Date.now() + 1);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("does not store entries with a negative TTL", async () => {
    const cache = createTtlCache();
    const loader = countingLoader("value");

    await cache.getOrLoad("k", -1, loader.load);
    await cache.getOrLoad("k", -1, loader.load);

    expect(loader.calls()).toBe(2);
    expect(cache.size).toBe(0);
  });
});

describe("LRU order", () => {
  it("moves a getOrLoad hit to the most recently used position", async () => {
    const cache = createTtlCache({ maxEntries: 3 });
    const loader = countingLoader("value");

    await cache.getOrLoad("a", 60_000, loader.load);
    await cache.getOrLoad("b", 60_000, loader.load);
    await cache.getOrLoad("c", 60_000, loader.load);

    // A hit, not just get(), must refresh recency.
    await cache.getOrLoad("a", 60_000, loader.load);
    await cache.getOrLoad("d", 60_000, loader.load);

    expect(loader.calls()).toBe(4);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("value");
    expect(cache.get("c")).toBe("value");
    expect(cache.get("d")).toBe("value");
  });

  it("refreshes recency and value when an existing key is written again", () => {
    const cache = createTtlCache({ maxEntries: 3 });

    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.set("c", 3, 60_000);
    cache.set("a", 10, 60_000);
    cache.set("d", 4, 60_000);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("drops expired entries before enforcing the bound", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const cache = createTtlCache({ maxEntries: 1 });
    cache.set("old", "old", 100);

    vi.setSystemTime(Date.now() + 101);
    cache.set("new", "new", 60_000);

    expect(cache.size).toBe(1);
    expect(cache.get("old")).toBeUndefined();
    expect(cache.get("new")).toBe("new");
  });

  it("evicts the only entry when the bound is one", () => {
    const cache = createTtlCache({ maxEntries: 1 });

    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);

    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("evicts the oldest entries first under the default bound", () => {
    const cache = createTtlCache();

    for (let index = 0; index < DEFAULT_MAX_ENTRIES; index += 1) {
      cache.set(`k${index}`, index, 60_000);
    }

    cache.set("newest", -1, 60_000);

    expect(cache.size).toBe(DEFAULT_MAX_ENTRIES);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k1")).toBe(1);
    expect(cache.get("newest")).toBe(-1);
  });

  it("rejects bounds that are not positive integers", () => {
    for (const maxEntries of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createTtlCache({ maxEntries })).toThrow(RangeError);
    }
  });
});

describe("coalescing failures", () => {
  it("propagates one rejection to every waiter and caches nothing", async () => {
    const cache = createTtlCache();
    let rejectLoad: ((error: Error) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    const first = cache.getOrLoad("k", 60_000, load);
    const second = cache.getOrLoad("k", 60_000, load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.pendingCount).toBe(1);

    const failure = new Error("upstream exploded");
    rejectLoad?.(failure);

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);

    expect(cache.pendingCount).toBe(0);
    expect(cache.size).toBe(0);
    expect(cache.get("k")).toBeUndefined();
  });

  it("starts a fresh load after a coalesced rejection", async () => {
    const cache = createTtlCache();
    let rejectLoad: ((error: Error) => void) | undefined;
    const first = cache.getOrLoad(
      "k",
      60_000,
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    const second = cache.getOrLoad(
      "k",
      60_000,
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    rejectLoad?.(new Error("first attempt failed"));

    await expect(Promise.allSettled([first, second])).resolves.toEqual([
      { status: "rejected", reason: expect.any(Error) },
      { status: "rejected", reason: expect.any(Error) },
    ]);

    await expect(cache.getOrLoad("k", 60_000, async () => "recovered")).resolves.toBe("recovered");
    expect(cache.get("k")).toBe("recovered");
  });
});

describe("bypass variants", () => {
  it("accepts case and surrounding whitespace for documented values", () => {
    for (const value of ["Yes", "YES", "ON", " true ", "\ttrue\n", "\nOn\t"]) {
      expect(isYouTubeCacheDisabled({ [YOUTUBE_CACHE_DISABLED_ENV_VAR]: value })).toBe(true);
    }
  });

  it("stays enabled for near-miss values", () => {
    for (const value of ["2", "enabled", "y", " true-ish ", "disabled", "off "]) {
      expect(isYouTubeCacheDisabled({ [YOUTUBE_CACHE_DISABLED_ENV_VAR]: value })).toBe(false);
    }
  });

  it("ignores unrelated environment variables", () => {
    expect(
      isYouTubeCacheDisabled({ YOUTUBE_CACHE_DISABLED_OTHER: "1", DISABLE_CACHE: "true" }),
    ).toBe(false);
  });
});

describe("housekeeping", () => {
  it("delete removes a live entry and the next load misses", async () => {
    const cache = createTtlCache();
    const loader = countingLoader("value");

    await cache.getOrLoad("k", 60_000, loader.load);
    cache.delete("k");

    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);

    await cache.getOrLoad("k", 60_000, loader.load);
    expect(loader.calls()).toBe(2);
  });

  it("clear drops entries and in-flight tracking", async () => {
    const cache = createTtlCache();
    let resolveLoad: ((value: string) => void) | undefined;
    const pending = cache.getOrLoad(
      "k",
      60_000,
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    cache.set("other", 1, 60_000);

    expect(cache.pendingCount).toBe(1);
    expect(cache.size).toBe(1);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.pendingCount).toBe(0);

    // Documented: a load already in flight still writes its entry afterwards.
    resolveLoad?.("late");
    await expect(pending).resolves.toBe("late");
    expect(cache.get("k")).toBe("late");
  });
});

describe("buildRequestCacheKey normalization", () => {
  it("drops undefined parameters entirely", () => {
    expect(buildRequestCacheKey("search", { q: "a", pageToken: undefined, part: undefined })).toBe(
      "search?q=a",
    );
  });

  it("keeps part and pageToken case-sensitive", () => {
    expect(buildRequestCacheKey("videos", { part: "snippet" })).not.toBe(
      buildRequestCacheKey("videos", { part: "Snippet" }),
    );
  });

  it("trims and collapses whitespace in every value", () => {
    expect(buildRequestCacheKey("videos", { part: "  snippet ,  contentDetails " })).toBe(
      "videos?part=snippet , contentDetails",
    );
  });

  it("upper-cases regionCode", () => {
    expect(buildRequestCacheKey("videos", { regionCode: " gb " })).toBe("videos?regionCode=GB");
  });

  it("normalizes id lists with whitespace and duplicates", () => {
    expect(buildRequestCacheKey("videos", { id: " b , a , b " })).toBe("videos?id=a,b");
  });

  it("serializes an empty parameter set", () => {
    expect(buildRequestCacheKey("search", {})).toBe("search?");
  });
});
