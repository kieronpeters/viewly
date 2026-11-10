/**
 * Bounded, in-process TTL cache with request coalescing, used by the server-only
 * YouTube client in `./client`.
 *
 * Design constraints, all deliberate:
 *
 * - **Process-local and memory-only.** Viewly is a single local Next.js process,
 *   so a module-level Map is the cheapest correct cache. Nothing is written to
 *   disk, nothing is shared between processes, and a restart empties it. This
 *   also keeps every entry far inside the 30-day storage limit that applies to
 *   Non-Authorized API Data (see `docs/YOUTUBE_DATA_POLICY.md`).
 * - **Bounded.** `maxEntries` is enforced on every write with LRU eviction, so a
 *   stream of unique queries cannot grow the heap without limit.
 * - **Expiring.** Every entry carries an absolute deadline; there is no
 *   stale-while-revalidate path and no background timer. An expired entry is
 *   dropped on the next read or write.
 * - **Coalescing.** Concurrent identical loads share one promise, so two
 *   request handlers asking for the same key produce one upstream request.
 * - **Errors are never stored.** Only fulfilled loads are written to the cache.
 *   Rejections are propagated to every waiter and forgotten immediately.
 * - **No secret material.** Keys are built from endpoint names and request
 *   parameters only. The API key is appended to the outbound URL inside the
 *   client, after the cache key has been computed, so it cannot be part of a
 *   key or a stored value.
 *
 * This module intentionally has no `server-only` import: it is generic, holds no
 * credentials, and is exercised directly by unit tests. The client that uses it
 * is server-only, which is what keeps it out of the browser bundle.
 */

/** Environment variable that turns the YouTube request cache off. */
export const YOUTUBE_CACHE_DISABLED_ENV_VAR = "YOUTUBE_CACHE_DISABLED";

/** Values of `YOUTUBE_CACHE_DISABLED` treated as "disabled" (case-insensitive). */
const DISABLED_VALUES: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);

/**
 * Default entry bound. Search payloads are the largest entries (roughly 40-80 KB
 * of raw JSON for 25 items); the rest are smaller. With short TTLs the live set
 * is normally a handful of entries, so 200 is generous headroom while keeping a
 * pathological worst case in the low tens of megabytes.
 */
export const DEFAULT_MAX_ENTRIES = 200;

/**
 * Time-to-live per logical endpoint.
 *
 * The numbers trade freshness against quota. They are short on purpose: a cache
 * miss costs quota, but a stale result is user-visible, and nothing here is
 * allowed to outlive the API data retention rules.
 *
 * - search (60 s): results drift constantly and `search.list` has the tightest
 *   budget (100 calls per day in its own bucket), so a short window absorbs
 *   pagination hops, React re-renders and duplicate tabs without serving stale
 *   results for long.
 * - video details (10 min): titles, durations and view counts move slowly.
 *   `videos.list` costs one unit from a 10,000 unit/day pool, so ten minutes is
 *   cheap freshness.
 * - trending (5 min): `mostPopular` shifts during the day; five minutes keeps
 *   the home page stable under refresh without hiding a genuinely new chart.
 * - comments (5 min): `commentThreads.list` moves constantly, and its text is
 *   display data only. Five minutes absorbs tab switches and pagination hops
 *   without keeping comment text in memory for longer than necessary.
 * - channels (24 h): `channels.list` returns a channel's name, avatar,
 *   subscriber count and uploads playlist id, which change on a scale of days,
 *   not minutes. One day caps a channel at one unit per day no matter how many
 *   videos the user opens, and the entry still expires well inside the 30-day
 *   retention limit for Non-Authorized API Data.
 * - playlist items (10 min): a channel's recent uploads change at most a few
 *   times a day, but a new upload should appear while the user is browsing.
 *   Ten minutes matches video details and costs one unit per distinct uploads
 *   page per window.
 */
export const YOUTUBE_CACHE_TTLS_MS = {
  search: 60_000,
  videoDetails: 10 * 60_000,
  trending: 5 * 60_000,
  comments: 5 * 60_000,
  channels: 24 * 60 * 60_000,
  playlistItems: 10 * 60_000,
} as const;

/** Options for {@link createTtlCache}. */
export interface TtlCacheOptions {
  /** Maximum number of live entries; must be a positive integer. */
  maxEntries?: number;
  /** Clock, injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/** A stored value plus the instant after which it must not be served. */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** Narrow interface, so callers can be handed a double in tests. */
export interface Cache {
  readonly size: number;
  readonly pendingCount: number;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  delete(key: string): void;
  clear(): void;
}

/**
 * Creates a bounded TTL cache with LRU eviction and single-flight loading.
 *
 * Eviction order is least-recently-used: a read or a write moves the key to the
 * back of the insertion-ordered `Map`, and the front is dropped when the bound
 * is reached.
 */
export function createTtlCache(options: TtlCacheOptions = {}): Cache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("TtlCache maxEntries must be a positive integer.");
  }

  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<unknown>>();

  /** Drops expired entries; called before a write so the bound only counts live data. */
  function evictExpired(): void {
    const at = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at) {
        entries.delete(key);
      }
    }
  }

  /**
   * Returns the live entry for `key` and marks it as recently used, or
   * `undefined` when the key is absent or expired.
   */
  function lookup(key: string): CacheEntry | undefined {
    const entry = entries.get(key);
    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }

    // Re-insert to move the key to the most-recently-used end of the Map.
    entries.delete(key);
    entries.set(key, entry);
    return entry;
  }

  function set<T>(key: string, value: T, ttlMs: number): void {
    // A non-positive TTL means "do not cache"; this is also how a bypass could
    // be expressed without an env var.
    if (!(ttlMs > 0)) {
      return;
    }

    evictExpired();
    entries.delete(key);

    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) {
        break;
      }

      entries.delete(oldest.value);
    }

    entries.set(key, { value, expiresAt: now() + ttlMs });
  }

  function getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cached = lookup(key);
    if (cached !== undefined) {
      return Promise.resolve(cached.value as T);
    }

    const pending = inFlight.get(key);
    if (pending !== undefined) {
      return pending as Promise<T>;
    }

    const promise = load().then((value) => {
      // Only fulfilled loads are stored: an error is never cached.
      set(key, value, ttlMs);
      return value;
    });

    inFlight.set(key, promise);
    const forget = (): void => {
      // Delete only our own promise, so a newer load for the same key survives.
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    };
    promise.then(forget, forget);

    return promise;
  }

  return {
    get size(): number {
      return entries.size;
    },
    get pendingCount(): number {
      return inFlight.size;
    },
    get<T>(key: string): T | undefined {
      const entry = lookup(key);
      return entry === undefined ? undefined : (entry.value as T);
    },
    set,
    getOrLoad,
    delete(key: string): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
      inFlight.clear();
    },
  };
}

/**
 * Whether caching is disabled for this call.
 *
 * `YOUTUBE_CACHE_DISABLED=1` (or `true`/`yes`/`on`, any case) is the documented
 * bypass for debugging a suspected stale result or measuring the true upstream
 * path. It is read on every call, not at module load, so it can be flipped in a
 * running shell without a rebuild. Disabled means: no reads, no writes and no
 * coalescing — every call goes to the network.
 */
export function isYouTubeCacheDisabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = (env[YOUTUBE_CACHE_DISABLED_ENV_VAR] ?? "").trim().toLowerCase();
  return DISABLED_VALUES.has(raw);
}

/**
 * Builds a deterministic cache key from an endpoint and its request parameters.
 *
 * The API key is never passed in here: the client appends it to the outbound URL
 * after the cache lookup. Callers must not add it to `params`.
 *
 * Normalization is deliberately narrow and documented:
 * - names are sorted, so parameter order cannot create a duplicate entry;
 * - `q` is trimmed, whitespace-collapsed and lower-cased, because YouTube search
 *   is case-insensitive;
 * - `id` is split, de-duplicated and sorted, so batches sharing the same ids
 *   share an entry regardless of order (the client restores caller order);
 * - `regionCode` is upper-cased, matching the client's validation;
 * - `publishedAfter` is an exact timestamp that moves with the clock, so it is
 *   floored to the minute; two filtered searches in the same minute therefore
 *   share an entry even though their outbound timestamps differ by milliseconds;
 * - every other value is trimmed and whitespace-collapsed only. `pageToken` and
 *   `part` stay case-sensitive.
 */
export function buildRequestCacheKey(
  endpoint: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  const parts: string[] = [];

  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    if (value === undefined) {
      continue;
    }

    parts.push(`${name}=${normalizeParam(name, value)}`);
  }

  return `${endpoint}?${parts.join("&")}`;
}

function normalizeParam(name: string, value: string): string {
  const collapsed = value.trim().replace(/\s+/g, " ");

  if (name === "q") {
    return collapsed.toLowerCase();
  }

  if (name === "regionCode") {
    return collapsed.toUpperCase();
  }

  if (name === "publishedAfter") {
    const timestamp = Date.parse(collapsed);
    if (Number.isNaN(timestamp)) {
      // The client always sends a valid ISO timestamp; an unparseable value is
      // kept verbatim so a bug cannot silently collapse two different requests.
      return collapsed;
    }

    return new Date(Math.floor(timestamp / 60_000) * 60_000).toISOString();
  }

  if (name === "id") {
    const ids = collapsed
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    return [...new Set(ids)].sort().join(",");
  }

  return collapsed;
}
