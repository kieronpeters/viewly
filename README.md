# Viewly

A local-first, single-user YouTube discovery app. Viewly runs on your machine, keeps everything in
a local SQLite file, and calls the YouTube Data API directly. There are no accounts, no cloud
database and no public deployment.

## Status

Working today:

- Next.js 16 App Router foundation with a responsive app shell (desktop sidebar, mobile bottom nav).
- Midnight Purple theme and shared UI primitives: buttons, cards, inputs, skeletons, and empty/error
  states.
- YouTube discovery: home page with trending and category rows, paginated search, and category pages,
  backed by a server-only client with a process-local TTL cache and typed errors.
- Watch page with the official YouTube embed, video metadata and description, favourite and watch
  later toggles, an add-to-playlist picker and related suggestions.
- Library at `/library` with four URL-backed tabs — Favourites, Watch later, History and Playlists —
  plus playlist creation and a detail route at `/library/playlists/[playlistId]`.
- History is written from the player on the first playback of a video, with per-entry remove and
  clear-all controls on the History tab.
- Watch statistics at `/library/stats`: estimated watch time, top channels, the current streak and a
  12-week activity heatmap, read from the local history.
- Keyless watch page: when `YOUTUBE_API_KEY` is missing, `/watch/[videoId]` renders an authored
  "YouTube is not configured" setup state that names the variable, instead of the player or the
  error boundary. The tab title stays neutral.
- SQLite + Drizzle ORM: schema for favourites, watch later, history, playlists and playlist items,
  plus a `settings` key/value table that holds the sweep marker; generated migrations, Server
  Actions for the save, history and playlist writes, and a server-only database client.
- Server-only environment module that reads the YouTube API key and fails with a named error when it
  is missing.
- Vitest suite, plus lint, type-check and formatting checks.

Not finished or not verified:

- **Live YouTube calls.** No owner-supplied API key is available in this workspace, so the YouTube
  client has only run against a stubbed `fetch`. Search, trending, video details and suggestions are
  unverified against the real API.
- **Retention (T46) is lazy.** Saved metadata is refreshed by a 30-day sweep on the `/library`
  request path, not a background job. The first request where `settings.last_sweep_at` is missing or
  older than 30 days re-fetches every distinct saved video in batches of 50 and rewrites its title,
  channel, thumbnail and duration. A video YouTube no longer returns keeps its row and becomes the
  authored "Unavailable video" placeholder. Because the sweep only runs when the app is opened, rows
  can be older than 30 days while Viewly is closed. An upstream failure leaves every stored snapshot
  untouched, and the sweep is retried on the next request because the marker is only advanced at the
  end. See [`docs/YOUTUBE_DATA_POLICY.md`](docs/YOUTUBE_DATA_POLICY.md).
- **Real-browser and player checks.** No browser or end-to-end test covers the embed, the save
  controls or the library tabs; they are exercised only in jsdom. Made-for-Kids handling,
  identifying the client to the player, card-level YouTube attribution and the Branding Guidelines
  review are also open; see [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Requirements

- **Node.js 22 or newer** — required: `better-sqlite3` 13 declares `engines.node >= 22`. The package
  ships prebuilt binaries for Linux (glibc and musl), macOS and Windows on x64 and arm64, so a
  normal install needs no compiler. npm may not run install scripts; `better-sqlite3` does not need
  one. Tested on Node 24.
- **npm** (ships with Node.js).
- **Git**.
- **A YouTube Data API v3 key** for search, trending and video details. Everything installs and runs
  without one: the watch page shows a setup state that points at `YOUTUBE_API_KEY`, discovery
  surfaces show an in-page error, and the API routes return `500 CONFIGURATION_ERROR` until it is
  set.

## Quick start

```bash
# 1. Clone the repository and enter it
git clone https://github.com/kieronpeters/viewly.git
cd viewly

# 2. Install dependencies (uses the bundled better-sqlite3 prebuild)
npm install

# 3. Create your local env file — run the line for your shell
copy .env.example .env.local     # Windows
cp .env.example .env.local       # macOS/Linux

# 4. Set YOUTUBE_API_KEY in .env.local (see "Getting a YouTube API key")

# 5. Apply migrations (Drizzle Kit creates data/ and the database file)
npm run db:migrate

# 6. Start the dev server
npm run dev
```

Open <http://localhost:3000>.

## Scripts

| Script                  | Runs                             | What it does                                                                  |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`           | `next dev`                       | Development server on port 3000 with hot reload.                              |
| `npm run build`         | `next build`                     | Production build.                                                             |
| `npm run check:secrets` | `node scripts/check-secrets.mjs` | Scan `.next/static` for the key variable name and an optional sentinel value. |
| `npm run start`         | `next start`                     | Serve the production build (run `build` first).                               |
| `npm run lint`          | `eslint`                         | Lint the project with the Next.js config.                                     |
| `npm run typecheck`     | `next typegen && tsc --noEmit`   | Generate Next.js route types, then type-check without emitting files.         |
| `npm test`              | `vitest run`                     | Run the test suite once.                                                      |
| `npm run test:watch`    | `vitest`                         | Run tests in watch mode.                                                      |
| `npm run format`        | `prettier --write .`             | Format the project in place.                                                  |
| `npm run format:check`  | `prettier --check .`             | Verify formatting without writing.                                            |
| `npm run db:generate`   | `drizzle-kit generate`           | Generate SQL migrations after editing `src/db/schema.ts`.                     |
| `npm run db:migrate`    | `drizzle-kit migrate`            | Apply pending migrations to the local database.                               |
| `npm run db:studio`     | `drizzle-kit studio`             | Browse the local database in Drizzle Studio.                                  |

`npm run check:secrets` reads the client bundle in `.next/static`, so run `npm run build` first;
without that directory the script exits with a failure telling you to build. `SECRET_SENTINEL` is
optional: set it to a fake value for the build and the check, and the scan also looks for that value
in the bundle. When it is unset, the value scan is skipped (the script says so) and only the
`YOUTUBE_API_KEY` name scan runs.

`npm install` can report npm audit findings from tooling dependencies; they do not block the install.
`npm run build` is also noisy: it prints a non-fatal Turbopack filesystem-tracing warning and
`/api/trending` prerender bailout lines logged as `[api-error ...]`, then finishes with the route
table and a zero exit code.

## Database

- **Location:** `data/viewly.db`, relative to the project root. Set `DATABASE_PATH` in `.env.local`
  (or in your shell) to use another file; relative values resolve against the project root. The app
  and Drizzle Kit read the same variable, so they agree on the file.
- **Mode:** WAL (`journal_mode = WAL`) with `foreign_keys = ON`, applied to every connection in
  `src/lib/db/client.ts`. WAL keeps concurrent readers from blocking the writer.
- **Schema:** one file, `src/db/schema.ts`. Generated SQL lives in `src/db/migrations/` and is
  committed. After a schema change run `npm run db:generate`, then `npm run db:migrate`.
- **Reset:** delete the file and migrate again:

  ```bash
  # macOS/Linux
  rm -f data/viewly.db data/viewly.db-wal data/viewly.db-shm
  npm run db:migrate

  # Windows (PowerShell)
  Remove-Item data/viewly.db* -ErrorAction SilentlyContinue
  npm run db:migrate
  ```

> This is local data only. Nothing syncs it, nothing backs it up, and deleting the file deletes
> everything you saved. `data/` and `*.db*` files are git-ignored.

## Getting a YouTube API key

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Go to **APIs & Services → Library**, search for **YouTube Data API v3**, and enable it.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Restrict the key to **YouTube Data API v3**.
5. Put it in `.env.local` at the project root as `YOUTUBE_API_KEY=...`, then restart `npm run dev`.

The key is read server-side only, through `src/lib/env.ts`, which imports `server-only`. Never
rename it to `NEXT_PUBLIC_YOUTUBE_API_KEY`: that prefix inlines the value into the JavaScript sent to
the browser. `.env.local` is git-ignored; the committed `.env.example` must never hold real values.

## Project structure

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — runtime shape, request flow, data model, route
  surface, and known gaps.
- [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) — folder layout, module boundaries,
  import rules, and where SQL and server-only code may live.
- [`docs/THEME.md`](docs/THEME.md) — Midnight Purple palette, tokens, contrast table, usage rules.
- [`docs/YOUTUBE_DATA_POLICY.md`](docs/YOUTUBE_DATA_POLICY.md) — what Viewly stores from YouTube, and where it falls short of the API terms.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — quota model, troubleshooting, compliance status and
  the pre-release checklist.

## Testing and quality

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run check:secrets
```

`npm run format` rewrites files, so run it when `format:check` reports differences. `check:secrets`
needs the `.next/static` output from `npm run build`.

## Troubleshooting

**`YOUTUBE_API_KEY is missing` / `missing_youtube_api_key`.** The key is unset, blank, or still a
placeholder. Add a real value to `.env.local` and restart the dev server; Next.js reads env files at
startup. Error messages name the variable, never the value.

**`better-sqlite3` fails to install or load.** It is a native addon and needs Node 22 or newer.
Check `node --version`, upgrade if needed, then run `npm install` again so the bundled prebuild for
your platform is unpacked. The package ships prebuilds for Linux (glibc and musl), macOS and Windows
on x64 and arm64; npm may skip install scripts, and that is fine.

**Port 3000 is already in use.** Use `npm run dev -- --port 3001` and open
<http://localhost:3001>, or stop the process holding port 3000.

**The database is in a bad state.** Delete `data/viewly.db` (and any `-wal` / `-shm` files), then
run `npm run db:migrate`. This discards all local data.

## Security and privacy

- Single-user by design: no accounts, no auth layer, no per-user data separation. Run it locally.
- No telemetry or analytics of our own. The watch page loads YouTube's embed, which is third-party
  content.
- The YouTube API key stays server-side; browser code never sees the variable name or its value.
- The SQLite file is plain, unencrypted local storage — protect the machine, not the file.
- Not intended for public deployment: nothing protects the database or your API quota.
