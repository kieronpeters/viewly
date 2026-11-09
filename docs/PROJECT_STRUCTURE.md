# Project Structure

Viewly is a modular monolith: one Next.js app, feature modules with explicit boundaries. This
document defines where code belongs and which imports are allowed. Empty folders are tracked with
`.gitkeep`; no `.gitkeep` file contains code.

## Layout

```text
src/
  app/                     Routes only: layouts, pages, route handlers (Alex owns)
  components/              Shared presentational UI: shadcn primitives + app-wide components (Alex owns)
  features/
    search/                Search feature: UI, hooks, use-cases, types
    video/                 Video detail/playback feature
    library/               Saved videos / library feature
  lib/
    youtube/               YouTube Data API client, quota + retry handling (server-only)
    db/                    Database client + repositories (server-only, the only place SQL lives)
    utils.ts               Existing `cn` helper (shadcn)
  db/
    migrations/            SQL migration files
    schema.ts              Single schema definition file (created in a later ticket)
  shared/                  Cross-cutting types/utils/constants (Victoria owns)
docs/                      Project documentation
```

`src/db/schema/` is deliberately **not** created. One schema file at `src/db/schema.ts` is easier to
review and keeps the skeleton small; split it into a folder only if the schema outgrows one file.
`src/db/migrations/` is created now because migrations arrive as raw SQL.

## What belongs in each folder

| Location              | Belongs here                                                                         | Does not belong here                                            |
| --------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/app`             | Route segments, `layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, route handlers | Business logic, SQL, API clients, reusable widgets              |
| `src/components`      | Presentational, reusable, domain-agnostic UI                                         | Data access, feature state, route-specific composition          |
| `src/features/<name>` | Feature UI, hooks, server-side use-cases, validation, feature-local types            | Cross-feature reuse (move it to `components`/`shared`), raw SQL |
| `src/lib/youtube`     | YouTube API access, response mapping, quota/retry policy                             | Persistence, React components, route code                       |
| `src/lib/db`          | Connection/client setup and repositories only                                        | UI, React hooks, request parsing, feature rules                 |
| `src/db`              | Schema definition (`schema.ts`) and migrations                                       | Query helpers used at runtime                                   |
| `src/shared`          | Framework-free types, constants, pure utilities                                      | Server-only code, DB/YouTube access, React components           |

## Composition vs features vs server-only modules

- **Pages compose.** A `page.tsx` (or a server component beneath it) fetches via a feature module and
  renders feature components. Pages contain no data-access code: no SQL, no `fetch` to YouTube, no
  repository imports.
- **Features own behaviour.** Each feature exposes a small public surface (its components plus
  server-side query/use-case functions). Everything else in the folder is private.
- **Server-only modules own I/O.** `src/lib/db` and `src/lib/youtube` are infrastructure. They are
  imported by feature use-cases and route handlers, never by client components.

## Import boundaries

Allowed direction: `app` → `features` → (`components`, `shared`, `lib`) → `db`/external APIs.

1. `src/app` may import `components`, `shared`, and **feature public entry points**. It must not import
   `src/lib/db` or `src/lib/youtube` directly.
2. A feature may import `components`, `shared`, `lib/db`, and `lib/youtube`. A feature must not reach
   into another feature's internals; if sharing is real, the code moves to `components`/`shared` or is
   exposed through the other feature's entry point.
3. `src/lib/db` may import `src/db/schema` and `shared`; it must not import `app` or `features`.
4. `src/lib/youtube` must not import `app`, `features`, or `src/lib/db`; persistence stays in repositories.
5. `src/components` and `src/shared` must not import `features`, `lib/db`, or `lib/youtube`.
6. No cycles between features, and no imports from `app` into any lower layer.

## SQL rule

SQL lives **only** in repositories under `src/lib/db` (for example `videos.repository.ts`). No SQL
string, query builder call, or schema import may appear in `src/app`, `src/components`,
`src/features`, or `src/lib/youtube`. Migrations under `src/db/migrations` are the one exception:
they define schema and are not application queries. Repositories expose typed functions; callers
never see the database client.

## Server-only rule

Environment access (`src/lib/env.ts`), the database client (`src/lib/db/client.ts`), and the YouTube
client (`src/lib/youtube/client.ts`) are server-only. Each module must import the `server-only`
marker as its first import when it lands (T04, T10, T13), so any client-component import fails at
build time instead of leaking secrets.

> Prerequisite: the `server-only` package is not currently in `package.json`. It must be added in
> T04/T10 before those modules are written (this ticket does not change dependencies).

## Rendering note (Next.js 16)

`cacheComponents` is enabled in `next.config.ts`, so uncached SQLite reads will use `connection()`
plus a `Suspense` boundary in later tickets; this skeleton adds no data fetching and no route code.

## Conventions

- Files and folders: kebab-case. React components: PascalCase exports.
- Repositories: `<entity>.repository.ts`; features export through `index.ts` once they have a public API.
- Never commit secrets. Local configuration belongs in ignored `.env*` files, validated by `src/lib/env.ts`.
