# Architecture

Viewly is a single-user, local-first Next.js app. This page describes the committed system as of
10 November 2026: runtime, module boundaries, data model and the routes that exist. Work still in
progress is called out in [Known gaps](#7-known-gaps), not presented as shipped.

## 1. Runtime shape

- **One process.** `next dev` or `next start` serves pages and route handlers from one Node.js
  process. Node 22 or newer is required because `better-sqlite3` is a native addon.
- **App Router.** Pages, layouts and route handlers live under `src/app`. UI is React Server
  Components by default; interactive files opt in with `"use client"`.
- **Static assets.** Files in `public/` (currently empty) are served by Next.js itself. There is no
  separate web server, CDN or asset host.
- **Local storage.** One SQLite file, `data/viewly.db` by default (`DATABASE_PATH` overrides it),
  opened through `better-sqlite3` with WAL and `PRAGMA foreign_keys = ON`. It is plain local state;
  there is no database server.
- **One external service.** Outbound HTTPS goes to YouTube: the Data API v3
  (`https://www.googleapis.com/youtube/v3`) from the server, and the embed
  (`https://www.youtube-nocookie.com`) from the watch page. There are no accounts, no auth layer, no
  cloud database, no queue or worker, no telemetry and no third-party scripts of our own.

`next.config.ts` enables `cacheComponents` and `partialPrefetching`, and allows images from
`i.ytimg.com`, `img.youtube.com` and `yt3.ggpht.com`.

## 2. Module layout and request flow

| Layer       | Location                                | Responsibility                                                   |
| ----------- | --------------------------------------- | ---------------------------------------------------------------- |
| Routes      | `src/app`                               | Layouts, pages and route handlers; no SQL or business rules      |
| Features    | `src/features/<name>`                   | Page-level server use-cases; feature UI and hooks                |
| Shared      | `src/shared`                            | Framework-free types, validation, normalization, formatting      |
| YouTube     | `src/lib/youtube/client.ts`             | HTTPS calls, timeouts, retry, typed upstream errors              |
| Persistence | `src/lib/db`                            | Connection singleton, Drizzle client, repositories; the only SQL |
| Schema      | `src/db/schema.ts`, `src/db/migrations` | Table definitions and committed SQL migrations                   |
| UI          | `src/components`                        | Presentational shell, primitives and video card                  |

The committed request path is:

```text
Browser
  -> src/app page.tsx or src/app/api/**/route.ts
     -> src/features/<feature> (when a page-level use case exists)
        -> src/lib/youtube/client.ts  --HTTPS-->  YouTube Data API v3
        -> src/lib/db/repositories/*  -------->  SQLite (data/viewly.db)
```

Committed API handlers are thin and call the YouTube client directly. Feature-level use cases exist
for categories (`src/features/search/categories.ts`) and the watch video (`src/features/video`), and
both wrap the same client. Pages compose components and feature output; `/library` (all four tabs
and playlist detail) and `/watch/[videoId]` (saved state) read through `src/features/library`.
Import rules are defined in [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md).

Current flows:

- `GET /api/search`: validate `q` and `pageToken`, call `searchVideos`, normalize with
  `src/shared/youtube.ts`, return a `SearchPage`.
- `GET /api/trending`: resolve region and page size, call `getTrending`, normalize a
  `VideoSummary[]`, return `{ items, regionCode }`.
- `GET /api/videos/[id]`: validate the path id, call `getVideo`, return `VideoDetail` or 404 when
  YouTube has no usable item.
- `GET /search`: a statically prerendered shell with the form and results behind `Suspense`. The
  results component awaits `searchParams`, validates `q`/`pageToken` and calls `searchVideos`
  in-process; it deliberately does not fetch `/api/search`.
- `GET /watch/[videoId]`: the page forwards `params` into `Suspense`; the route validates the id
  and `readWatchVideo` calls `getWatchVideo`/`getVideo`. An invalid id or unknown video calls
  `notFound()`. A missing `YOUTUBE_API_KEY` is returned as `configuration_error` and renders the
  authored "YouTube is not configured" state (the tab title stays neutral); other failures still
  reach the error boundary. The normal result renders the official player, metadata/description
  panel and save controls.
- `GET /library`: resolves `?tab=` to favourites (default), watch later, history or playlists;
  unknown or stale values fall back to favourites. Before either read it awaits
  `sweepLibraryMetadata()`, so cards never render a snapshot the sweep was about to replace. Tab
  counts come from `countLibraryEntries` and only the active tab's list is read from SQLite inside
  `Suspense`. The playlists tab creates playlists and links to their detail pages.
- `GET /library/playlists/[playlistId]`: validates the id, reads the playlist and its ordered item
  ids, then batches `getVideos` for the valid ids. Missing metadata renders an "Unavailable video"
  row that can still be removed; the page also offers rename and delete controls.
- History recording: the watch player calls the `recordView` Server Action on the first `PLAYING`
  state. It upserts the `history` row, bumping `view_count` and `last_viewed_at`; a failed write is
  swallowed so playback is unaffected.
- `GET /category/[slug]`: resolves the public slug, fetches one page of videos with an optional
  `?pageToken=`, and paginates by link. Unknown slugs call `notFound()`; API failures render in-page.

Across requests, two cache layers apply. The API route handlers send HTTP cache headers: search sends
`public, max-age=60, stale-while-revalidate=300`; trending sends
`public, max-age=60, s-maxage=60, stale-while-revalidate=120`; video details send
`public, max-age=60, s-maxage=300`. Separately, the YouTube client wraps every logical call in a
process-local TTL cache (`src/lib/youtube/cache.ts`): search 60 s, video details 10 min, trending
5 min, categories 24 h. Entries are keyed by endpoint and normalized parameters (never the API key),
bounded at 200 with LRU eviction, and shared by concurrent identical calls. Errors are never
cached, a hit returns before the key is read, and `YOUTUBE_CACHE_DISABLED=1` bypasses the cache for
debugging. It is memory-only and lost on restart; there is no SQLite query cache. The client still
sends `cache: "no-store"` upstream with an 8 second timeout and retries a 429/5xx response once.
`getWatchVideo` also uses React's `cache()` so `generateMetadata` and the page body share one call
per render.

## 3. Server/client boundaries

- `src/lib/env.ts`, `src/lib/db/client.ts`, `src/lib/youtube/client.ts`,
  `src/lib/db/repositories/library.repository.ts` and
  `src/features/library/metadata-sweep.ts` import `server-only`, so a client import fails at build
  time.
- The YouTube key is read from `process.env.YOUTUBE_API_KEY` on the server only, lazily per call.
  It is never prefixed `NEXT_PUBLIC_`, never returned, and only written into the outbound request
  URL. Error logging redacts key-shaped strings.
- Client components are limited to presentation and interaction (nav links, the error boundary, the
  player wrapper, save/playlist controls and shared UI primitives). They receive props, not database
  clients or API keys.
- Every API failure uses `{ "error": { "code", "message", "field"? } }` from `src/lib/errors.ts`:

| Code                  | HTTP | Typical cause                                        |
| --------------------- | ---- | ---------------------------------------------------- |
| `VALIDATION_FAILED`   | 400  | Bad search param, page token, region or video id     |
| `NOT_FOUND`           | 404  | YouTube returned no usable video                     |
| `RATE_LIMITED`        | 429  | YouTube quota exceeded                               |
| `UNAVAILABLE`         | 503  | Defined; no current route emits it                   |
| `UPSTREAM_ERROR`      | 502  | YouTube transport failure, timeout or malformed body |
| `CONFIGURATION_ERROR` | 500  | Missing or rejected API key                          |
| `INTERNAL_ERROR`      | 500  | Unexpected server failure                            |

- `cacheComponents` is enabled. `better-sqlite3` is synchronous and is not cached by Next.js, so
  any request-time SQLite read during rendering must be wrapped in `connection()` from
  `next/server` or placed behind a `Suspense` boundary. API route handlers already run per request,
  and `/search`, `/library`, `/library/playlists/[playlistId]` and `/watch/[videoId]` put
  request-time work behind `Suspense`. `/library` (the metadata sweep, tab counts and the active
  list), `/library/playlists/[playlistId]` (playlist and items) and `/watch/[videoId]` (saved state)
  perform SQLite reads there.

## 4. Data model

Eight tables, defined once in `src/db/schema.ts` and created by
`src/db/migrations/0000_mute_slapstick.sql` (the five library tables),
`0001_solid_betty_ross.sql` (`settings`), `0002_video_notes.sql`
(`video_notes`) and `0003_tricky_kylun.sql` (`video_progress`), with
`0004_misty_warlock.sql` adding the notes timestamp (T90). “Snapshot” means `title`,
`channel_title`, `thumbnail_url` and nullable `duration_seconds`.

| Table            | Primary key               | Other columns                                                   | Constraints and indexes                                                                                                                                  |
| ---------------- | ------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `favourites`     | `video_id`                | snapshot, `saved_at`                                            | `saved_at` NOT NULL; index `favourites_saved_at_idx` (`saved_at`)                                                                                        |
| `watch_later`    | `video_id`                | snapshot, `saved_at`                                            | `saved_at` NOT NULL; index `watch_later_saved_at_idx` (`saved_at`)                                                                                       |
| `history`        | `video_id`                | snapshot, `last_viewed_at`, `view_count`                        | `view_count` defaults to 1 and has CHECK `>= 0`; index `history_last_viewed_at_idx`                                                                      |
| `playlists`      | `id` (application UUID)   | `name`, `created_at`, `updated_at`                              | no additional index                                                                                                                                      |
| `playlist_items` | `(playlist_id, video_id)` | `position`, `added_at`                                          | FK `playlist_id` -> `playlists.id` ON DELETE CASCADE; CHECK `position >= 0`; index `playlist_items_playlist_id_position_idx` (`playlist_id`, `position`) |
| `settings`       | `key` (text)              | `value`, `updated_at`                                           | key/value store; today holds only `last_sweep_at` for the metadata sweep                                                                                 |
| `video_notes`    | `id` (application UUID)   | `video_id`, `body`, `start_seconds`, `created_at`, `updated_at` | nullable `start_seconds` with CHECK `IS NULL OR >= 0`; indexes on `(video_id, created_at)` and `(video_id, start_seconds)`                               |
| `video_progress` | `video_id`                | `position_seconds`, `duration_seconds`, `updated_at`            | CHECK `position_seconds >= 0` and `duration_seconds > 0`; index on `updated_at`                                                                          |

Notes:

- The three snapshot copies are intentional: a saved row renders when the API is down or the video
  is deleted. There is no shared `videos` cache table.
- Every `*_at` column is UTC milliseconds stored as an integer (`timestamp_ms`); nothing reads the
  database clock. `duration_seconds` is null for live streams and missing details.
- Favourite and watch-later saves use `ON CONFLICT DO NOTHING`, and the composite key makes adding
  the same video to a playlist a no-op. `history` uses an upsert to bump `view_count` and
  `last_viewed_at` on the single row for that video.
- Cascade only works when the connection has `PRAGMA foreign_keys = ON`. `src/lib/db/client.ts` sets
  it for the app; tests, scripts and `sqlite3` sessions must set it too, or deleting a playlist
  leaves its items behind.
- `position` is append-only and not unique; removing an item leaves a gap rather than renumbering.
- `settings` is application state, not API Data: `key` is a text primary key, `value` is a non-null
  string and `updated_at` is UTC milliseconds. Its only key today is `last_sweep_at`, an ISO-8601
  timestamp written by the metadata sweep.
- `video_notes` holds both local free-text notes and timestamped highlights (T79, T90). A `null`
  `start_seconds` is a note; a whole-second position is a highlight, ordered by `start_seconds` in
  the watch panel and validated as `0 <= start_seconds <= duration` by the Server Action before it
  writes. There is no second table, so T87's export/import scope is one row shape and carries the
  nullable timestamp verbatim; existing pre-T90 rows upgrade to `null`.

## 5. Route surface

Only committed routes are listed. `src/app/error.tsx` and `src/app/not-found.tsx` are global
boundaries, not routes.

| Route                             | Method | Purpose                                                              | Statuses                                                                                                                |
| --------------------------------- | ------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/`                               | GET    | Discovery: trending and category rows                                | 200                                                                                                                     |
| `/search`                         | GET    | Search form and streamed results                                     | 200; invalid input and API failures render in-page states, not error statuses                                           |
| `/watch/[videoId]`                | GET    | Player, metadata, description and save controls; keyless setup state | 200, or 200 with the keyless setup state; 404 invalid id or unknown video; 500 via error boundary on unexpected failure |
| `/library`                        | GET    | Library tabs: favourites, watch later, history and playlists         | 200; an unknown `?tab=` falls back to favourites                                                                        |
| `/library/playlists/[playlistId]` | GET    | One playlist, its ordered items and manage controls                  | 200; 404 invalid or unknown playlist id                                                                                 |
| `/category/[slug]`                | GET    | Category results, link pagination                                    | 200; 404 unknown slug; API failures render in-page states                                                               |
| `/api/search`                     | GET    | One page of video search results                                     | 200; 400 bad `q`/`pageToken`; 429 quota; 500 config/internal; 502 upstream                                              |
| `/api/trending`                   | GET    | Most popular videos for a region                                     | 200; 400 bad `region`/`maxResults`; 429 quota; 500 config/internal; 502 upstream                                        |
| `/api/videos/[id]`                | GET    | One video's normalized details                                       | 200; 400 invalid id; 404 no usable video; 429 quota; 500 config/internal; 502 upstream                                  |

The shell links to `/search` and `/library`.

## 6. Testing and quality

```bash
npm test              # Vitest once
npm run test:watch    # Vitest watch mode
npm run typecheck     # next typegen && tsc --noEmit
npm run lint          # ESLint
npm run format:check  # Prettier check
npm run build         # next build
npm run check:secrets # scan .next/static for the key name and a sentinel
```

Vitest runs in jsdom using `tests/setup.ts` and collects `tests/**` plus co-located
`src/**/*.test.ts(x)`. Route tests mock `server-only` and the YouTube call; client tests stub
`fetch`; repository tests run the real migrations against a temporary SQLite file. Run
`npm run build` before `check:secrets`, which reads `.next/static`.

Background: [`README.md`](../README.md) · [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) ·
[`THEME.md`](THEME.md) · [`YOUTUBE_DATA_POLICY.md`](YOUTUBE_DATA_POLICY.md).

## 7. Known gaps

- **Playback compliance.** `/watch/[videoId]` mounts the official YouTube IFrame API player
  (`https://www.youtube.com/iframe_api`) with `host: https://www.youtube-nocookie.com` and
  `playerVars: { rel: 0, autoplay: 0 }`; the API creates the iframe and Viewly sets its title,
  `loading="lazy"` and size on ready, with an "Open on YouTube" fallback link beside the box. The
  Made-for-Kids lookup, identifying the client to the player and the Branding Guidelines review are
  still open.
- **Retention is lazy.** Saved snapshots are refreshed by `src/features/library/metadata-sweep.ts`,
  not a scheduled job: the first `/library` request where `settings.last_sweep_at` is missing or
  older than 30 days re-fetches every distinct saved video in batches of 50, rewrites the snapshot,
  and relabels videos YouTube no longer returns as the authored "Unavailable video". Nothing is
  deleted. Rows can be older than 30 days while the app is closed. An upstream failure leaves every
  stored snapshot untouched and the sweep is retried on the next request, because the marker is only
  advanced at the end.
- **Live YouTube smoke.** Unit tests cover request shape and error mapping with a stubbed `fetch`.
  No real API call has been recorded because no owner-supplied key is available in this workspace.
