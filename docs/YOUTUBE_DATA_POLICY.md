# YouTube Data Policy

What Viewly stores from the YouTube Data API, what it deliberately does not store, and where the
current code does not yet meet the YouTube API Services Terms of Service or Developer Policies.

Owner: Priya (Technical Writer). Reviewed: **10 November 2026**. Re-check the sources before any
release that adds caching, playback or sharing.

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
in detail**; that review belongs to the playback ticket (T30).

## What Viewly is

A local, single-user application. It runs on the owner's machine, stores data in one SQLite file
(`data/viewly.db`), and calls the YouTube Data API v3 with a key the owner supplies. There are no
accounts, no OAuth, no user credentials and no server operated by anyone else. Every API response
Viewly receives is **Non-Authorized Data** in the policy's sense, because a plain API key is used
rather than a user grant.

## What Viewly stores

The schema in `src/db/schema.ts` is the authoritative list. There are five tables and no others.

| Table            | Columns stored                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `favourites`     | `video_id`, `title`, `channel_title`, `thumbnail_url`, `duration_seconds`, `saved_at`                     |
| `watch_later`    | `video_id`, `title`, `channel_title`, `thumbnail_url`, `duration_seconds`, `saved_at`                     |
| `history`        | `video_id`, `title`, `channel_title`, `thumbnail_url`, `duration_seconds`, `last_viewed_at`, `view_count` |
| `playlists`      | `id` (application-generated UUID), `name`, `created_at`, `updated_at`                                     |
| `playlist_items` | `playlist_id`, `video_id`, `position`, `added_at`                                                         |

Notes on that table, all verifiable in the schema file:

- The saved-video snapshot is exactly **video id, title, channel title, thumbnail URL and duration**.
  The same four display fields are duplicated per row rather than referenced from a shared cache, so
  a saved item can still render if the API is unavailable.
- `duration_seconds` is nullable, because the API omits duration for live streams and for videos
  whose details are unavailable.
- Timestamps (`saved_at`, `last_viewed_at`, `added_at`, `created_at`, `updated_at`) are UTC
  milliseconds stored as integers. Nothing is stamped by a database default; callers pass the time.
- `history.view_count` is a **local** counter of how many times the video was opened in Viewly. It is
  not YouTube's view count and is not presented as one.
- `playlist_items` stores **no** title, channel, thumbnail or duration. Playlist contents can only be
  rendered by fetching those videos from the API. See "Known gaps".
- Thumbnail URLs point at YouTube's own hosts (`i.ytimg.com`, `img.youtube.com`, `yt3.ggpht.com`).
  Viewly stores the URL, not the image. Images are loaded from YouTube, either by the browser or by
  the Next.js image optimiser, which keeps a short-lived copy under `.next/cache/images`.
- No repository or route handler writes to these tables yet. The schema is committed, but at the time
  of this review `src/lib/db/` contains only the connection module and `src/app/` has no API routes.
  The storage contract above is therefore the schema, not observed runtime behaviour. It must be
  re-checked when the library routes land.

## What Viewly does not store

- **No video or audio media.** No downloads, no stream URLs, no DASH/HLS manifests, no signed media
  URLs, no offline copies, no re-hosting. Developer Policies III.E.1 prohibits all of these without
  YouTube's prior written approval.
- **No descriptions.** `VideoDetail.description` exists only in memory for a single watch request.
  It is returned to the caller and never written to the database.
- **No YouTube statistics.** `viewCount` from the API is fetched as part of `videos.list` and held in
  memory so a card can display it, but it is not persisted. If a future cache stores it, the 30-day
  rule in III.E.4.b applies.
- **No channel ids, publish dates, categories, tags, captions or comments.** These are either
  normalised into memory (`channelId`, `publishedAt`) and discarded, or never requested.
- **No search history.** Search queries and page tokens are not persisted.
- **No credentials.** No passwords, no OAuth tokens, no Google account data. The only secret is the
  owner's API key, which lives in `.env.local` and is never written to the database.
- **No telemetry or analytics.** Nothing about usage leaves the machine apart from the API requests
  themselves.

## Search results and the future cache

`searchVideos()` in `src/lib/youtube/client.ts` calls `search.list` with `part=snippet` and
`type=video`, normalises the response in `src/shared/youtube.ts`, and returns a `SearchPage` in
memory. The outbound request is sent with `cache: "no-store"`, and the client's own header comment
states that caching and quota bookkeeping are out of scope and belong to a later ticket. There is no
table for search results and nothing writes one.

When T18 adds a cache:

- entries must expire on a short TTL and be refreshed rather than kept;
- a cached search result must never become a library row on its own — only an explicit user save
  writes to `favourites`, `watch_later` or a playlist;
- the cache must not outlive the 30-day limit that applies to Non-Authorized API Data
  (III.E.4.d);
- thumbnail bytes cached by the image optimiser are also API Data and should be covered by the same
  review.

## Playback

**Playback is not built.** There is no player component, no embed URL and no iframe in `src/`. The
video card links to an internal `/watch/[id]` route that does not exist yet.

When T30 adds playback, the official YouTube embedded player (IFrame Player API) is the only
mechanism. Viewly must not proxy, download, re-host or separate the audio and video components, and
must not build a background player (III.E.1, III.I.6–III.I.9). The same ticket must also handle:

- looking up the Made for Kids status of every embedded video and disabling tracking where required
  (III.E.4.j);
- keeping autoplay off by default, so playback data is not shared before the user interacts
  (III.E.4.i);
- identifying the client to the player as required by the Required Minimum Functionality document;
- displaying the player and its attribution unmodified (III.F.2).

## Attribution and branding

Nothing renders YouTube content today, so no attribution is implemented yet. The intended behaviour,
to be built with the search and watch pages:

- every video links to its YouTube watch page (`https://www.youtube.com/watch?v=<id>`), and the link
  is clearly a link off-site;
- YouTube is identified as the source of titles, thumbnails and durations, using YouTube Brand
  Features in line with the Branding Guidelines (III.F.2, ToS §10);
- YouTube branding inside the embedded player is never covered, cropped or replaced;
- Viewly does not state or imply that YouTube sponsors, endorses or is affiliated with it
  (ToS §13);
- any locally computed value (such as `history.view_count`) is visibly not presented as YouTube data
  (III.E.4.h).

The current `VideoCard` falls short of the first two points: it links internally and carries no
YouTube mark. See "Known gaps".

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
  requirement for a user's deletion request (III.E.4.g). What is missing is an in-app control — see
  "Known gaps".

**Retention is the main open problem.** Rows are kept indefinitely and are never refreshed. III.E.4.d
allows Non-Authorized API Data to be stored only while necessary and **not longer than 30 calendar
days**, after which it must be deleted or refreshed. A favourite saved two years ago is neither.

## Quota

YouTube sets the quota and Viewly must not exceed or circumvent it (ToS §15). At the time of
checking, a project has 100 `search.list` calls per day, 100 `videos.insert` calls per day (unused by
Viewly) and 10,000 units per day shared across the other endpoints; daily quotas reset at midnight
Pacific Time.

`searchVideos`, `getVideo`, `getVideos`, `listVideoCategories` and `getTrending` all consume quota
from those buckets. The client retries a 429 or 5xx response once, then maps `403 quotaExceeded` to
the `quota` error code so the UI can show a specific message rather than a generic failure. There is
no local quota ledger and no request budgeting yet. What the app does when the quota is exhausted
will be specified in T43.

## Known gaps

These are places where the current or planned behaviour does not meet the published terms. They are
listed rather than worked around.

1. **Permanent snapshots exceed the 30-day storage limit (III.E.4.d).** `favourites`, `watch_later`
   and `history` keep title, channel, thumbnail and duration indefinitely with no TTL and no refresh
   job. Because Viewly uses a bare API key, this is Non-Authorized Data, not Authorized Data, so the
   longer retention allowed by III.E.4.b.2 does not apply. A remediation (refresh on library load,
   a scheduled revalidation of rows older than 30 days, or a 30-day sweep) is needed before the
   library ships.
2. **Stored metadata drifts (III.E.4.e, III.E.4.f).** Titles, thumbnails and durations change;
   videos are made private or deleted. A snapshot never updates, and the UI does not label it as
   saved-at-a-point-in-time. The same fix as gap 1 covers this.
3. **No user-facing privacy policy or YouTube terms link (III.A.1, III.A.2).** The policies require
   a prominently displayed privacy policy that names YouTube API Services and links the Google
   Privacy Policy, plus a link to the YouTube Terms of Service and a statement that using the app
   means accepting them. This document is developer documentation and does not satisfy that, and the
   app has no such screen. It matters as soon as anyone other than the owner runs Viewly.
4. **Attribution is not implemented (III.F.2, ToS §10).** `VideoCard` links to `/watch/[id]` and shows
   no YouTube branding, so a card does not yet make clear that YouTube is the source. Search and
   watch pages must fix this when they land.
5. **`playlist_items` has no display snapshot.** The T19 brief assumed playlist items store title,
   channel, thumbnail and duration; they do not. Playlist rendering therefore needs a `videos.list`
   call, costs quota, and cannot show anything for a video that has been deleted or made private. It
   also contradicts the rationale in `src/db/schema.ts`, which says a saved item must render without
   an API call. Either add the snapshot columns (and the matching migration) or document playlists as
   an id-only list.
6. **Playback requirements are unbuilt (III.E.4.i, III.E.4.j, III.C.1, III.F).** Made for Kids
   handling, autoplay default, player identity and the Branding Guidelines and Required Minimum
   Functionality documents are all T30 work. None of it exists or has been reviewed.
7. **"Substitute service" risk (III.I.1).** A YouTube client must add significant independent value
   and must not recreate YouTube's browse experience. Viewly's discovery-plus-local-library premise
   is defensible, but this should be re-read at T30 and T43 rather than assumed.
8. **No in-app deletion control (III.E.4.g).** Deletion is fast, but the only mechanism is removing a
   row or deleting the database file by hand. A "delete all my data" action would make the
   requirement demonstrable.

## Verifying this document

Each storage claim can be checked against `src/db/schema.ts`; each key-handling claim against
`src/lib/env.ts`, `src/lib/youtube/client.ts` and `src/lib/errors.ts`; each "not stored" claim by
searching `src/` for the field name. Formatting is checked with:

```bash
npx prettier --check docs/YOUTUBE_DATA_POLICY.md README.md
```

Update the "Reviewed" date and the sources table whenever the YouTube documents or this schema
change.
