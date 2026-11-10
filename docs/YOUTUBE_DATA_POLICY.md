# YouTube Data Policy

What Viewly stores from the YouTube Data API, what it deliberately does not store, and where the
current code does not yet meet the YouTube API Services Terms of Service or Developer Policies.

Maintained by the technical writing workstream. Reviewed: **10 November 2026**. Re-check the sources
before any release that changes caching, playback or sharing.

This is an engineering record of what the code does, checked against the published terms. It is not
legal advice, and it does not replace the YouTube documents it cites.

## Sources

All URLs were opened on 10 November 2026. The most recent entry in the official revision history at
that date is **1 June 2026** (a clarification to the derived-metrics and data-storage policies).

| Document                                                              | URL                                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| YouTube API Services Terms of Service                                 | <https://developers.google.com/youtube/terms/api-services-terms-of-service>  |
| YouTube API Services Developer Policies                               | <https://developers.google.com/youtube/terms/developer-policies>             |
| Terms of Service revision history                                     | <https://developers.google.com/youtube/terms/revision-history>               |
| Quota costs (YouTube Data API v3)                                     | <https://developers.google.com/youtube/v3/determine_quota_cost>              |
| YouTube Terms of Service                                              | <https://www.youtube.com/t/terms>                                            |
| Branding Guidelines (referenced by both documents)                    | <https://developers.google.com/youtube/terms/branding-guidelines>            |
| Required Minimum Functionality (referenced by the Developer Policies) | <https://developers.google.com/youtube/terms/required-minimum-functionality> |

Sections cited below are from the Developer Policies unless marked "ToS" (Terms of Service). The
Branding Guidelines and Required Minimum Functionality have been identified but **not yet reviewed
in detail**; that review is still open (see "Playback").

## What Viewly is

A local, single-user application. It runs on the owner's machine, stores data in one SQLite file
(`data/viewly.db`), and calls the YouTube Data API v3 with a key the owner supplies. There are no
accounts, no OAuth, no user credentials and no server operated by anyone else. Every API response
Viewly receives is **Non-Authorized Data** in the policy's sense, because a plain API key is used
rather than a user grant.

## What Viewly stores

The schema in `src/db/schema.ts` is the authoritative list. There are six tables and no others: five
library tables and one `settings` key/value table.

| Table            | Columns stored                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `favourites`     | `video_id`, `title`, `channel_title`, `thumbnail_url`, `duration_seconds`, `saved_at`                     |
| `watch_later`    | `video_id`, `title`, `channel_title`, `thumbnail_url`, `duration_seconds`, `saved_at`                     |
| `history`        | `video_id`, `title`, `channel_title`, `thumbnail_url`, `duration_seconds`, `last_viewed_at`, `view_count` |
| `playlists`      | `id` (application-generated UUID), `name`, `created_at`, `updated_at`                                     |
| `playlist_items` | `playlist_id`, `video_id`, `position`, `added_at`                                                         |
| `settings`       | `key` (text primary key), `value`, `updated_at`                                                           |

Notes on that table, all verifiable in the schema file:

- The saved-video snapshot is exactly **video id, title, channel title, thumbnail URL and duration**.
  The same four display fields are duplicated per row rather than referenced from a shared videos
  table, so a saved item can still render if the API is unavailable.
- `duration_seconds` is nullable, because the API omits duration for live streams and for videos
  whose details are unavailable.
- Timestamps (`saved_at`, `last_viewed_at`, `added_at`, `created_at`, `updated_at`) are UTC
  milliseconds stored as integers. Nothing is stamped by a database default; callers pass the time.
- `history.view_count` is a **local** counter of how many times the video was opened in Viewly. It is
  not YouTube's view count and is not presented as one.
- `playlist_items` stores **no** title, channel, thumbnail or duration. Playlist contents can only be
  rendered by fetching those videos from the API. See "Known gaps".
- `settings` stores application state, not API Data: today its only key is `last_sweep_at`, an
  ISO-8601 timestamp written by the metadata sweep. It holds no title, channel, thumbnail, duration
  or id.
- Thumbnail URLs point at YouTube's own hosts (`i.ytimg.com`, `img.youtube.com`, `yt3.ggpht.com`).
  Viewly stores the URL, not the image. Images are loaded from YouTube, either by the browser or by
  the Next.js image optimiser, which keeps a short-lived copy under `.next/cache/images`.
- Runtime writes exist for all three saved-video tables and for playlists. `toggleFavourite` and
  `toggleWatchLater` in `src/features/library/actions.ts`, `recordView` /
  `clearHistoryEntry` / `clearAllHistory` in `src/features/library/history-actions.ts`, and
  `createPlaylist` / `renamePlaylist` / `deletePlaylist` / `addToPlaylist` / `removeFromPlaylist` in
  `src/features/library/playlist-actions.ts` all write through
  `src/lib/db/repositories/library.repository.ts`. The storage contract above is the schema.

## What Viewly does not store

- **No video or audio media.** No downloads, no stream URLs, no DASH/HLS manifests, no signed media
  URLs, no offline copies, no re-hosting. Developer Policies III.E.1 prohibits all of these without
  YouTube's prior written approval.
- **No video or channel descriptions.** `VideoDetail.description` and
  `ChannelDetail.description` exist only in memory: they are returned to the caller and may sit in the
  TTL cache for up to 10 minutes (video details or uploads) or 24 hours (channel identity), but they
  are never written to the database.
- **No YouTube statistics.** `viewCount` from the API is fetched as part of `videos.list` and held in
  memory so a card can display it, but it is not persisted. The shared cache holds it in memory for
  at most 10 minutes; the 30-day rule in III.E.4.b applies to anything persisted later.
- **No channel ids, publish dates, categories, tags or captions.** These are either normalised into
  memory (`channelId`, `publishedAt`) and discarded, or never requested.
- **No persisted comments.** The watch page's Comments tab reads top-level threads through
  `commentThreads.list`, normalises only the fields it renders (author, plain-text body, like count,
  publish time, reply count), and holds them in the process cache for at most 5 minutes. Comment text
  is never written to SQLite, localStorage, logs or any other durable store.
- **No search history.** Search queries and page tokens are not persisted.
- **No credentials.** No passwords, no OAuth tokens, no Google account data. The only secret is the
  owner's API key, which lives in `.env.local` and is never written to the database.
- **No telemetry or analytics of our own.** Outbound traffic is the API requests plus the YouTube
  embed that the watch page loads; Viewly adds no analytics or tracking.

## Search results and the cache

`searchVideos()` in `src/lib/youtube/client.ts` calls `search.list` with `part=snippet` and
`type=video`, normalises the response in `src/shared/youtube.ts`, and returns a `SearchPage` in
memory. There is no table for search results and nothing writes one.

The only place an API payload is retained is the process-local TTL cache in
`src/lib/youtube/cache.ts`, which wraps every client call:

- TTLs are search 60 s, video details 10 min, trending 5 min, categories 24 h, comments 5 min,
  channels 24 h and playlist items (channel uploads) 10 min. Entries are bounded at 200 with LRU
  eviction and are lost on restart; nothing is written to disk.
- Keys contain the endpoint and normalized parameters only. The API key is appended after the cache
  lookup and never stored; errors are never cached, and concurrent identical calls share one request.
- The longest TTL (24 h) is far inside the 30-day limit for Non-Authorized API Data (III.E.4.d).
- A cached search result never becomes a library row on its own. Only an explicit save or a playback
  record writes a row, and only to `favourites`, `watch_later` or `history`.
- `YOUTUBE_CACHE_DISABLED=1` bypasses the cache for debugging.
- Thumbnail bytes cached by the image optimiser are also API Data and remain covered by this review.

## Playback

**Playback is built** with the official YouTube embedded player, driven by the YouTube IFrame API.
`src/components/video/youtube-player.tsx` loads `https://www.youtube.com/iframe_api` (only once the
player nears the viewport) and constructs `YT.Player` with the video id,
`host: "https://www.youtube-nocookie.com"` and `playerVars: { rel: 0, autoplay: 0 }`. The API creates
the iframe itself; Viewly's `onReady` handler sets the accessible title, `loading="lazy"` and a 100%
size inside a React-owned 16:9 box, and does not set `allowFullScreen` itself — fullscreen is
whatever the API's iframe permits. An "Open on YouTube" link to
`https://www.youtube.com/watch?v=<id>` sits beside the box. The player is unmodified; Viewly does not
proxy, download, re-host or separate the audio and video components, and there is no background
player (III.E.1, III.I.6–III.I.9).

Still open for playback:

- looking up the Made for Kids status of every embedded video and disabling tracking where required
  (III.E.4.j);
- identifying the client to the player as required by the Required Minimum Functionality document;
- reviewing the Branding Guidelines and confirming the player's attribution (III.F.2).

Autoplay is off: `autoplay: 0` is passed in `playerVars`, so playback data is not shared before the
user interacts (III.E.4.i).

## Attribution and branding

Attribution is partial. The watch page renders the official player unmodified and offers an
"Open on YouTube" link to `https://www.youtube.com/watch?v=<id>`. `VideoCard` links only to the
internal `/watch/[id]` route and carries no YouTube mark, so cards do not yet identify YouTube as
the source.

The finished surfaces must:

- link every video to its YouTube watch page (`https://www.youtube.com/watch?v=<id>`), clearly as a
  link off-site;
- identify YouTube as the source of titles, thumbnails and durations, using YouTube Brand Features
  in line with the Branding Guidelines (III.F.2, ToS §10);
- never cover, crop or replace YouTube branding inside the embedded player;
- not state or imply that YouTube sponsors, endorses or is affiliated with Viewly (ToS §13);
- keep any locally computed value (such as `history.view_count`) visibly not presented as YouTube
  data (III.E.4.h).

The first two points remain open for `VideoCard`. See "Known gaps".

## API key handling

- `YOUTUBE_API_KEY` is read only through `getYoutubeApiKey()` in `src/lib/env.ts`, which imports
  `server-only`. Importing it from a Client Component is a build error.
- The client in `src/lib/youtube/client.ts` also imports `server-only`, reads the key lazily per
  logical call, and puts it only in the outbound request URL.
- The key is never attached to a returned object, never interpolated into an error message and never
  logged. Errors carry a stable code, the HTTP status and YouTube's short `reason` string instead of
  the URL; the original `fetch` error is deliberately discarded because its message can contain the
  request URL.
- `src/lib/errors.ts` additionally redacts Google-key-shaped strings, `?key=` query parameters,
  bearer tokens and the configured key value from anything logged or returned to the browser.
- `.env.local` is git-ignored; `.env.example` holds placeholders only, and `getYoutubeApiKey()`
  rejects known placeholder values. The variable must never be renamed with a `NEXT_PUBLIC_` prefix.
- The key is the owner's own and is never embedded in the repository, which is what III.D.1.d
  requires of an open-source project. One Google Cloud project per API client is III.D.1.c.

## Retention and deletion

- A library row lives until the user removes it. Deleting a `favourites`, `watch_later` or `history`
  row deletes that video's local snapshot with it; nothing is retained elsewhere.
- Deleting a playlist cascades to its `playlist_items` rows. This relies on
  `PRAGMA foreign_keys = ON`, which `src/lib/db/client.ts` sets on every connection.
- Deleting the database removes everything: `data/viewly.db` plus `viewly.db-wal` and
  `viewly.db-shm`. The README documents this reset. There is no backup, no sync and no other copy.
- Deletion is immediate, which satisfies the "as soon as possible and within 7 calendar days"
  requirement for a user's deletion request (III.E.4.g). History can be cleared from `/library`;
  what is missing is one action that covers every table — see "Known gaps".

**Retention is handled by a lazy 30-day sweep (T46, option A).** III.E.4.d allows Non-Authorized API
Data to be stored only while necessary and **not longer than 30 calendar days**, after which it must
be deleted or refreshed. `src/features/library/metadata-sweep.ts` runs on the `/library` request
path: when the `last_sweep_at` value in `settings` is absent or older than 30 days, it re-fetches
every distinct saved video in batches of 50 and rewrites the stored snapshot before the tab counts
and list render. The marker is written only after every row has been applied, so an upstream failure
leaves every stored snapshot untouched and the sweep is retried on the next request. Nothing is
deleted: a video YouTube no longer returns keeps its row and is relabelled with the authored
"Unavailable video" snapshot and an `i.ytimg.com` thumbnail URL.

The limit is not enforced while the app is closed. There is no background worker, so a library that
is not opened for months holds rows older than 30 days until the next visit, which sweeps before
showing them. Playlist items store ids only and are not swept; their metadata is fetched per render.

## Quota

YouTube sets the quota and Viewly must not exceed or circumvent it (ToS §15). At the time of
checking, a project has 100 `search.list` calls per day, 100 `videos.insert` calls per day (unused by
Viewly) and 10,000 units per day shared across the other endpoints; daily quotas reset at midnight
Pacific Time.

`searchVideos`, `getVideo`, `getVideos` and `getTrending` all consume quota
from those buckets, and the shared cache absorbs repeat calls. The client retries a 429 or 5xx
response once, then maps `403 quotaExceeded` to the `quota` error code. There is no local quota ledger
and no request budgeting. Quota exhaustion and the user-facing copy are documented in
[`OPERATIONS.md`](OPERATIONS.md): `quota` becomes 429 `RATE_LIMITED` on all three API routes
(`/api/search`, `/api/trending`, `/api/videos/[id]`).

## Known gaps

These are places where the current or planned behaviour does not meet the published terms. They are
listed rather than worked around.

1. **The 30-day refresh is lazy, not guaranteed (III.E.4.d).** The sweep above refreshes a saved
   snapshot on the first library visit after 30 days, so the limit is enforced on the request path
   rather than on a clock. A library left unopened keeps older rows until it is opened, and a failed
   sweep does not advance the marker, so the rows stay stale until a later request succeeds. A
   scheduled job would close this; a single-user local app has no worker to run one.
2. **Metadata can still drift between sweeps (III.E.4.e, III.E.4.f).** Titles, thumbnails and
   durations change, and videos are made private or deleted. The sweep corrects that at most every 30
   days, and the UI does not label a snapshot as saved-at-a-point-in-time. The sweep is the
   remediation; the labelling is still missing.
3. **No user-facing privacy policy or YouTube terms link (III.A.1, III.A.2).** The policies require
   a prominently displayed privacy policy that names YouTube API Services and links the Google
   Privacy Policy, plus a link to the YouTube Terms of Service and a statement that using the app
   means accepting them. This document is developer documentation and does not satisfy that, and the
   app has no such screen. It matters as soon as anyone other than the owner runs Viewly.
4. **Card attribution is incomplete (III.F.2, ToS §10).** The watch page embeds the official player
   and links to the YouTube watch page, but `VideoCard` links only to `/watch/[id]` and shows no
   YouTube branding, so list, search and library cards do not make the source clear.
5. **`playlist_items` has no display snapshot.** The T19 brief assumed playlist items store title,
   channel, thumbnail and duration; they do not. Playlist rendering therefore needs a `videos.list`
   call, costs quota, and cannot show anything for a video that has been deleted or made private. It
   also contradicts the rationale in `src/db/schema.ts`, which says a saved item must render without
   an API call. Either add the snapshot columns (and the matching migration) or document playlists as
   an id-only list.
6. **Some playback requirements remain (III.E.4.j, III.C.1, III.F).** The official embed and
   autoplay-off are implemented, but Made for Kids handling, client identification to the player and
   the Branding Guidelines / Required Minimum Functionality review are still missing.
7. **"Substitute service" risk (III.I.1).** A YouTube client must add significant independent value
   and must not recreate YouTube's browse experience. Viewly's discovery-plus-local-library premise
   is defensible, but this should be re-read whenever discovery, playback or quota handling changes.
8. **No single "delete all my data" control (III.E.4.g).** History can be cleared per entry or in
   full from `/library`, and saved videos and playlists can be removed one at a time, but there is no
   one action that wipes every table; deleting the database file by hand is the only complete reset.
   A "delete all my data" action would make the requirement demonstrable.

## Verifying this document

Each storage claim can be checked against `src/db/schema.ts`; each key-handling claim against
`src/lib/env.ts`, `src/lib/youtube/client.ts` and `src/lib/errors.ts`; each retention claim against
`src/features/library/metadata-sweep.ts` (and `metadata-sweep.test.ts`); each playback claim against
`src/components/video/youtube-player.tsx`; each "not stored" claim by searching `src/` for the field
name. Formatting is checked with:

```bash
npx prettier --check docs/YOUTUBE_DATA_POLICY.md README.md
```

Update the "Reviewed" date and the sources table whenever the YouTube documents or this schema
change.
