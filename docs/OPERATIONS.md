# Operations

Quota, troubleshooting, compliance status and day-to-day operation of the local Viewly app. Owner:
Priya (Technical Writer). Figures checked on **10 November 2026**; re-check before a release that
changes caching, endpoints or playback.

## 1. Quota

Viewly uses one Google Cloud project key. YouTube enforces the budget; Viewly keeps no local quota
ledger. Exceeding quota is a policy violation (ToS §15), which is why the request cache exists.

### Current model

Source: <https://developers.google.com/youtube/v3/determine_quota_cost> (opened 10 November 2026).
`search.list` and `videos.insert` each have their own bucket of **100 calls/day**; every other
endpoint shares **10,000 units/day**. Daily quotas reset at **midnight Pacific Time**. Every request,
including an invalid one, costs at least one point.

| Client call           | Endpoint               | Cost per request                    |
| --------------------- | ---------------------- | ----------------------------------- |
| `searchVideos`        | `search.list`          | 1 of 100 search calls/day, per page |
| `getVideo`            | `videos.list`          | 1 of 10,000 units/day               |
| `getVideos`           | `videos.list`          | 1 unit per batch of up to 50 ids    |
| `getTrending`         | `videos.list` (chart)  | 1 of 10,000 units/day               |
| `listVideoCategories` | `videoCategories.list` | 1 of 10,000 units/day, per region   |

Every retry of a 429/5xx response and every extra results page is another billable call.

### Cache TTLs

The cache is process-local, memory-only, bounded at 200 entries (LRU) and lost on restart. A hit
returns before the API key is read, so it costs nothing; errors are never cached. Concurrent
identical calls share one request. See `src/lib/youtube/cache.ts`.

| Endpoint            | TTL  | What the window absorbs                                                     |
| ------------------- | ---- | --------------------------------------------------------------------------- |
| `search.list`       | 60 s | Pagination hops, re-renders, duplicate tabs; search has the tightest budget |
| `videos.list`       | 10 m | Repeat detail and watch-page loads; titles and counts drift slowly          |
| `videos.list` chart | 5 m  | Home-page refreshes while the trending chart is still current               |
| `videoCategories`   | 24 h | Region-scoped category lists that change only when YouTube does             |

A day of ordinary browsing — 20 searches, 200 detail views, 50 trending loads — costs 20 of the 100
search calls and 250 of the 10,000 shared units, so the search bucket binds first. Without the
cache, a refresh-heavy session can spend several times that.

### When the quota is exhausted

YouTube answers `403` with `reason: quotaExceeded`. The client maps that to its own `quota` code,
and all three API routes translate it to **429 `RATE_LIMITED`**:

| Surface                 | What the user sees                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/search`       | `Search is temporarily unavailable because the YouTube API quota has been exceeded. Please try again later.`         |
| `GET /api/trending`     | `Too many trending requests right now. Please try again shortly.`                                                    |
| `GET /api/videos/[id]`  | `Video details are temporarily unavailable because the YouTube API quota has been exceeded. Please try again later.` |
| `/search` (in-page)     | `Search is unavailable right now because the YouTube API quota has been reached. Please try again later.`            |
| Home sections (in-page) | `The YouTube API quota has been reached. Please try again later.`                                                    |

A literal `429` from YouTube is not the quota signal: the client retries it once and then reports
`bad_request`, which all three routes surface as `502`. Errors are never cached, so a failed request
always goes upstream. The `/watch/[videoId]` page renders through the global error boundary.

### Verifying these figures

Open <https://developers.google.com/youtube/v3/determine_quota_cost>; the intro states 100
`search.list`, 100 `videos.insert` and 10,000 shared units per day, reset at midnight PT, and the
`search` / `videos` rows show cost 1 per call — no legacy "100 units per search" figure. Actual
consumption is on the Google Cloud console **Quotas** page linked from that document.

## 2. Troubleshooting

| Symptom                                                      | Cause                                       | Fix                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `missing_youtube_api_key`; `YOUTUBE_API_KEY is missing. ...` | Key unset, blank or a known placeholder     | Add a real key to `.env.local` and restart. Browser sees `500 CONFIGURATION_ERROR`.      |
| `500 CONFIGURATION_ERROR`, upstream `auth`                   | YouTube rejected the key (`keyInvalid`)     | Check the key; ensure YouTube Data API v3 is enabled for its project.                    |
| `better-sqlite3` install or load failure                     | Addon built for another Node version        | `node --version` must be 22+; then `npm install` or `npm rebuild better-sqlite3`.        |
| Migration fails, or SQLite cannot open the file              | `DATABASE_PATH` unwritable, or file corrupt | Parent directory is auto-created. Check path and permissions; if corrupt, reset (below). |
| `Port 3000 is already in use`                                | Another process holds the port              | `npm run dev -- --port 3001`, or stop that process.                                      |
| Suspected stale result                                       | A live cache entry inside its TTL           | `YOUTUBE_CACHE_DISABLED=1` (or `true`/`yes`/`on`); read per call, no rebuild.            |

Keep `src/db/migrations/0000_mute_slapstick.sql` and `meta/_journal.json` committed, or Drizzle Kit
loses its history. After a schema edit run `npm run db:generate`, then `npm run db:migrate`.

**Reset the local database.** Delete `data/viewly.db` plus any `-wal` / `-shm` files
(`Remove-Item data/viewly.db* -ErrorAction SilentlyContinue` on Windows, or
`rm -f data/viewly.db data/viewly.db-wal data/viewly.db-shm`), then run `npm run db:migrate`. This
discards all local data.

**Logs.** `logServerError` in `src/lib/errors.ts` writes one `console.error` line per failure to the
terminal running `npm run dev` or `npm run start`, for example
`[api-error 4f2c9a1b7d30] YouTubeApiError { scope: 'GET /api/search', ... }`. Each line carries the
scope, a redacted message and stack and safe details. Quote the request id when reporting a problem;
the browser only ever receives authored copy. Validation failures (400) are not logged.

## 3. Compliance

See [`YOUTUBE_DATA_POLICY.md`](YOUTUBE_DATA_POLICY.md) for the full review, sources and clause
references. Read it before any release.

- **30-day retention gap — open.** Non-Authorized API Data may be kept no longer than 30 calendar
  days (III.E.4.d). Saved favourites keep title, channel, thumbnail and duration indefinitely with
  no TTL, refresh or sweep; `watch_later` and `history` share the same schema. The in-memory cache is
  within the limit (24 h maximum, gone on restart), the library tables are not. **T46 is open and
  needs an owner decision** on refresh-on-load, revalidation or a sweep. Do not call stored metadata
  compliant.
- **Attribution and official player.** The watch page uses YouTube's official embed
  (`youtube-nocookie.com`, no proxying, downloading or re-hosting) and shows an "Open on YouTube"
  link. `VideoCard` still links only to the internal `/watch/[id]` route and carries no YouTube
  mark, so card-level attribution is not implemented and branding has not been reviewed.
- **Playback compliance items.** The official player and autoplay-off are in place. Made-for-Kids
  handling, identifying the client to the player (Required Minimum Functionality) and the Branding
  Guidelines / Required Minimum Functionality review are still missing or unreviewed.
- No privacy policy screen, YouTube Terms link or in-app deletion control exists.

Nothing in the current build should be presented as fully compliant with the YouTube API Services
Terms or Developer Policies.

## 4. Operations

### Run locally

```bash
npm install
copy .env.example .env.local # Windows; cp on macOS/Linux, then set YOUTUBE_API_KEY
npm run db:migrate
npm run dev
```

Open <http://localhost:3000>. The database is `data/viewly.db` unless `DATABASE_PATH` overrides it.

### What healthy looks like

- `npm run dev` prints the Next.js ready line with no startup error, and `/` returns 200.
- `/search?q=<terms>` returns results or a clear empty state, and `GET /api/trending` returns
  `200 { items, regionCode }`, with a real key configured.
- The terminal shows no `[api-error ...]` lines during normal browsing.
- `data/viewly.db` exists after `npm run db:migrate`; the app creates the file lazily but never
  applies schema changes, so migrations stay mandatory.
- Repeated identical requests inside a TTL produce no new upstream call; disable the cache to
  compare.

### Pre-release checklist

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
$env:SECRET_SENTINEL='AIzaSySENTINEL_DO_NOT_USE_000000000'; npm run check:secrets
```

`check:secrets` reads `.next/static`, so run it after `npm run build`. Then do a **live smoke with a
real key**: restart `npm run dev`, load `/`, `/search?q=test`, `/watch/<known-video-id>`, and call
`/api/search`, `/api/trending` and `/api/videos/<id>`. Confirm 200s, working pagination, and no key
or upstream URL in any response or log line. The client header still records the live smoke as
**PENDING**; unit tests stub `fetch`.
