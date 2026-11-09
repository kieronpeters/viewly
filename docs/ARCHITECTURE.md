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
- **One external service.** Outbound HTTPS goes to the YouTube Data API v3
  (`https://www.googleapis.com/youtube/v3`). There are no accounts, no auth layer, no cloud
  database, no queue or worker, no telemetry and no third-party scripts.

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
both wrap the same client. Pages compose components and feature output; no committed page reads
SQLite. Import rules are defined in [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md).

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
  and `getWatchVideo` calls `getVideo`. An invalid id or unknown video calls `notFound()`.

Across requests, caching in the committed build is HTTP-only: search sends
`public, max-age=60, stale-while-revalidate=300`; trending sends
`public, max-age=60, s-maxage=60, stale-while-revalidate=120`; video details send
`public, max-age=60, s-maxage=300`. The YouTube client sends `cache: "no-store"` with an 8 second
timeout and retries a 429/5xx response once. `getWatchVideo` also uses React's `cache()` so
`generateMetadata` and the page body share one call per render. There is no cross-request
application cache and no SQLite query cache. T18 (shared YouTube cache) is in progress and is not
described here.

## 3. Server/client boundaries

- `src/lib/env.ts`, `src/lib/db/client.ts`, `src/lib/youtube/client.ts` and
  `src/lib/db/repositories/library.repository.ts` import `server-only`, so a client import fails at
  build time.
- The YouTube key is read from `process.env.YOUTUBE_API_KEY` on the server only, lazily per call.
  It is never prefixed `NEXT_PUBLIC_`, never returned, and only written into the outbound request
  URL. Error logging redacts key-shaped strings.
- Client components are limited to presentation and interaction (`nav-links.tsx`, `error.tsx`,
  shared UI primitives). They receive props, not database clients or API keys.
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
  and the committed `/search` and `/watch/[videoId]` pages put request-time work behind `Suspense`.
  No committed page performs a database read.

## 4. Data model

Five tables, defined once in `src/db/schema.ts` and created by
`src/db/migrations/0000_mute_slapstick.sql`. “Snapshot” means `title`, `channel_title`,
`thumbnail_url` and nullable `duration_seconds`.

| Table            | Primary key               | Other columns                            | Constraints and indexes                                                                                                                                  |
| ---------------- | ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `favourites`     | `video_id`                | snapshot, `saved_at`                     | `saved_at` NOT NULL; index `favourites_saved_at_idx` (`saved_at`)                                                                                        |
| `watch_later`    | `video_id`                | snapshot, `saved_at`                     | `saved_at` NOT NULL; index `watch_later_saved_at_idx` (`saved_at`)                                                                                       |
| `history`        | `video_id`                | snapshot, `last_viewed_at`, `view_count` | `view_count` defaults to 1 and has CHECK `>= 0`; index `history_last_viewed_at_idx`                                                                      |
| `playlists`      | `id` (application UUID)   | `name`, `created_at`, `updated_at`       | no additional index                                                                                                                                      |
| `playlist_items` | `(playlist_id, video_id)` | `position`, `added_at`                   | FK `playlist_id` -> `playlists.id` ON DELETE CASCADE; CHECK `position >= 0`; index `playlist_items_playlist_id_position_idx` (`playlist_id`, `position`) |

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

## 5. Route surface

Only committed routes are listed. `src/app/error.tsx` and `src/app/not-found.tsx` are global
boundaries, not routes.

| Route              | Method | Purpose                          | Statuses                                                                           |
| ------------------ | ------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| `/`                | GET    | Static placeholder home page     | 200                                                                                |
| `/search`          | GET    | Search form and streamed results | 200; invalid input and API failures render in-page states, not error statuses      |
| `/watch/[videoId]` | GET    | Video detail page                | 200; 404 invalid id or unknown video; 500 via error boundary on unexpected failure |
| `/api/search`      | GET    | One page of video search results | 200; 400 bad `q`/`pageToken`; 429 quota; 500 config/internal; 502 upstream         |
| `/api/trending`    | GET    | Most popular videos for a region | 200; 400 bad `region`/`maxResults`; 429 quota; 500 config/internal; 502 upstream   |
| `/api/videos/[id]` | GET    | One video's normalized details   | 200; 400 invalid id; 404 no usable video; 500 config/internal; 502 upstream        |

The shell links to `/search` and `/library`. `/search` is built; no page file for `/library` is
committed, so in the committed tree it falls through to the 404 boundary.

## 6. Testing and quality

```bash
npm test              # Vitest once
npm run test:watch    # Vitest watch mode
npm run typecheck     # tsc --noEmit
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

- **Library UI and API.** The schema and `library.repository.ts` exist, but there are no library
  pages, route handlers or feature components.
- **Playback.** The committed watch page renders a placeholder in the player slot; the embedded
  player (T30) and metadata/description panel (T31) are being built concurrently.
- **Caching.** No cross-request YouTube cache is committed; the shared cache (T18) is in progress.
- **Retention.** The 30-day retention problem in `YOUTUBE_DATA_POLICY.md` is unresolved; the
  retention decision is T46.
- **Live YouTube smoke.** Unit tests cover request shape and error mapping with a stubbed `fetch`.
  No real API call has been recorded because no owner-supplied key is available in this workspace.
