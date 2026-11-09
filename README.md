# Viewly

A local-first, single-user YouTube discovery app. Viewly runs on your machine, keeps everything in
a local SQLite file, and calls the YouTube Data API directly. There are no accounts, no cloud
database and no public deployment.

## Status

Working today:

- Next.js 16 App Router foundation with a responsive app shell (desktop sidebar, mobile bottom nav).
- Midnight Purple theme and shared UI primitives: buttons, cards, inputs, skeletons, empty/error
  states, toasts.
- SQLite + Drizzle ORM: schema, generated migrations, and a server-only database client.
- Server-only environment module that reads the YouTube API key and fails with a named error when it
  is missing.
- Vitest suite, plus lint, type-check and formatting checks.

Still being built: YouTube search, video playback, and the library (favourites, watch later,
playlists, history). The home page is a placeholder and the `Search` / `Library` nav links have no
routes behind them yet.

## Requirements

- **Node.js 22 or newer** — `better-sqlite3` 13 declares `engines.node >= 22`. Tested on Node 24.
- **npm** (ships with Node.js).
- **Git**.
- **A YouTube Data API v3 key** for the discovery features, once they land. Everything installs and
  runs without one.

## Quick start

```bash
# 1. Install dependencies (pulls the better-sqlite3 build for your Node version)
npm install

# 2. Create your local env file — run the line for your shell
copy .env.example .env.local     # Windows
cp .env.example .env.local       # macOS/Linux

# 3. Set YOUTUBE_API_KEY in .env.local (see "Getting a YouTube API key")

# 4. Create the database folder, then apply migrations
mkdir data                       # Drizzle Kit does not create the parent directory
npm run db:migrate

# 5. Start the dev server
npm run dev
```

Open <http://localhost:3000>.

## Scripts

| Script                 | Runs                   | What it does                                              |
| ---------------------- | ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | `next dev`             | Development server on port 3000 with hot reload.          |
| `npm run build`        | `next build`           | Production build.                                         |
| `npm run start`        | `next start`           | Serve the production build (run `build` first).           |
| `npm run lint`         | `eslint`               | Lint the project with the Next.js config.                 |
| `npm run typecheck`    | `tsc --noEmit`         | Type-check without emitting files.                        |
| `npm test`             | `vitest run`           | Run the test suite once.                                  |
| `npm run test:watch`   | `vitest`               | Run tests in watch mode.                                  |
| `npm run format`       | `prettier --write .`   | Format the project in place.                              |
| `npm run format:check` | `prettier --check .`   | Verify formatting without writing.                        |
| `npm run db:generate`  | `drizzle-kit generate` | Generate SQL migrations after editing `src/db/schema.ts`. |
| `npm run db:migrate`   | `drizzle-kit migrate`  | Apply pending migrations to the local database.           |
| `npm run db:studio`    | `drizzle-kit studio`   | Browse the local database in Drizzle Studio.              |

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

## Testing and quality

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`npm run format` rewrites files, so run it when `format:check` reports differences.

## Troubleshooting

**`YOUTUBE_API_KEY is missing` / `missing_youtube_api_key`.** The key is unset, blank, or still a
placeholder. Add a real value to `.env.local` and restart the dev server; Next.js reads env files at
startup. Error messages name the variable, never the value.

**`better-sqlite3` fails to install or load.** It is a native addon and needs Node 22 or newer.
Check `node --version`, upgrade if needed, then run `npm install` (or `npm rebuild better-sqlite3`)
so the addon is built for the active Node version.

**`Cannot open database because the directory does not exist`.** The parent folder of the database
file is missing. Run `mkdir data` (or create your `DATABASE_PATH` folder) and re-run
`npm run db:migrate`.

**Port 3000 is already in use.** Use `npm run dev -- --port 3001` and open
<http://localhost:3001>, or stop the process holding port 3000.

**The database is in a bad state.** Delete `data/viewly.db` (and any `-wal` / `-shm` files), then
run `npm run db:migrate`. This discards all local data.

## Security and privacy

- Single-user by design: no accounts, no auth layer, no per-user data separation. Run it locally.
- No telemetry, no analytics, no third-party scripts.
- The YouTube API key stays server-side; browser code never sees the variable name or its value.
- The SQLite file is plain, unencrypted local storage — protect the machine, not the file.
- Not intended for public deployment: nothing protects the database or your API quota.
