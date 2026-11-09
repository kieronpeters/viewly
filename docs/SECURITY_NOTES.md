# Security Notes

Maintained by the security workstream. This file records security checks that were actually run, with
the commands and their output, so the evidence can be re-verified. Do not add a check here that has
not been executed.

## Status

- **T08 below is a historical record**, captured on 10 November 2026 against commit `9562733`. It is
  kept as written so the result stays re-readable; it does not describe the current tree. Where a
  statement has since become false, the text is annotated rather than rewritten.
- **Current re-check** is at the end of this file and records only what was re-run on 10 November
  2026 against commit `0d75f5c` (HEAD at the time).

## T08 — API key isolation and server-only boundaries (historical, commit `9562733`)

Baseline: commit `9562733`, Next.js 16.4.5 (Turbopack), Node v24.21.0, Windows / PowerShell. The
working tree also contained other in-progress changes under `src/db/**` and `tests/**`; none of them
were modified by this check.

### What was checked

1. Server-only markers on every module that reads the YouTube key:
   - `src/lib/env.ts:13` — `import "server-only";` (first import, after the module doc comment).
   - `src/lib/db/client.ts:51` — `import "server-only";` (first import).
   - `src/lib/youtube/client.ts` — **not present at the time of this check.** The folder held only
     `.gitkeep` and an in-progress test file; the client itself had not landed, so its marker could
     not be verified. It exists today; see the re-check at the end of this file.
2. Import graph: no Client Component imports these modules. The only `"use client"` files in `src/`
   are `src/app/error.tsx` and `src/components/layout/nav-links.tsx`; neither imports `lib/env`,
   `lib/db/client`, or `lib/youtube`. Repo-wide, the only importers of `@/lib/env` are
   `src/lib/errors.ts` (a server module) and the unit tests; `@/lib/db/client` is imported only by
   its own test. `lib/youtube` has no importers yet. (Historical: `src/` now contains more client
   components and `lib/youtube` has importers.)
3. No `NEXT_PUBLIC_` reference exists in `src/`; the only mentions are the wording inside
   `src/lib/env.ts` (an error message) and its test.
4. Production client bundle scanned for the variable name and for a fake key value.

### The checker

`scripts/check-secrets.mjs`, run via the `check:secrets` npm script
(`package.json`: `"check:secrets": "node scripts/check-secrets.mjs"`).

- Dependency-free (`node:fs`, `node:path` only); no network, no real key required.
- Fails (exit 1) and prints `FAIL: found <label> in <file>` for every file under `.next/static` that
  contains the literal `YOUTUBE_API_KEY` or the exact `SECRET_SENTINEL` value. Files are read as
  byte buffers, so the scan is binary-safe and covers source maps if they are ever emitted there.
- Exits 1 with an actionable message if `.next/static` is missing (i.e. no build to inspect).
- Prints `PASS — scanned N file(s) (M bytes) ...` when clean.
- If `SECRET_SENTINEL` is unset, the sentinel-value half of the scan is skipped and reported as
  `SKIPPED`; the `YOUTUBE_API_KEY` name scan still runs. CI should set `SECRET_SENTINEL` at build
  time for the value scan to mean anything.

### Negative control (proves the check can fail)

A temporary file `.next/static/planted-leak-test.js` was created containing both needles, then
deleted:

```powershell
$env:SECRET_SENTINEL='AIzaSySENTINEL_DO_NOT_USE_000000000'
Set-Content .next/static/planted-leak-test.js -Value 'const k = process.env.YOUTUBE_API_KEY; const v = "AIzaSySENTINEL_DO_NOT_USE_000000000";'
npm run check:secrets   # exit 1
```

Output:

```text
check-secrets: scanning .next\static
FAIL: found "YOUTUBE_API_KEY" in .next\static\planted-leak-test.js
FAIL: found the SECRET_SENTINEL value in .next\static\planted-leak-test.js
check-secrets: FAILED — 2 finding(s) across 23 file(s) in .next\static.
```

The planted file was removed immediately; subsequent runs were clean.

### Production build with a fake key

The sentinel is a deliberately invalid, non-credential key shape; it was supplied only through the
process environment and written to no file.

```powershell
$env:YOUTUBE_API_KEY='AIzaSySENTINEL_DO_NOT_USE_000000000'
npm run build
```

Result: exit 0. `✓ Compiled successfully in 1677ms`, TypeScript finished, 4/4 static pages
generated, routes `/` and `/_not-found` prerendered. A `server-only` violation (a Client Component
importing one of these modules) fails at compile time; none occurred.

### Bundle scan result

```powershell
$env:SECRET_SENTINEL='AIzaSySENTINEL_DO_NOT_USE_000000000'
npm run check:secrets
```

```text
check-secrets: scanning .next\static
check-secrets: PASS — scanned 25 file(s) (807395 bytes) in .next\static; neither "YOUTUBE_API_KEY" nor the SECRET_SENTINEL value is present.
```

At that commit the build emitted 25 files; the same scan now reports 34 (see the re-check below).

Independent grep, not using the script:

```powershell
$files = Get-ChildItem -Recurse -File .next/static
$files | Select-String -SimpleMatch 'YOUTUBE_API_KEY'
$files | Select-String -SimpleMatch 'AIzaSySENTINEL_DO_NOT_USE_000000000'
```

- `YOUTUBE_API_KEY`: no matches.
- `AIzaSySENTINEL_DO_NOT_USE_000000000`: no matches.
- `.next/static` contained 25 files at that commit and no `.map` source maps.
- Extra sanity greps in `.next/static` for `getYoutubeApiKey`, `EnvConfigurationError`,
  `YOUTUBE_API_KEY_ENV_VAR`, `better-sqlite3` and `DATABASE_PATH`: 0 matches each.
- The sentinel does not appear anywhere under `.next` (server output included), consistent with
  Next.js keeping non-`NEXT_PUBLIC_` variables out of inlined build output.

### Residual risk

- **Scope is the client bundle only.** `scripts/check-secrets.mjs` inspects `.next/static`; server
  output under `.next/server` and any middleware bundle are not gated. They were grepped once by
  hand (clean) but are not covered by CI.
- **Build-time evidence, not runtime behaviour.** The scan proves the key value is not statically
  embedded in browser assets. It cannot detect a key leaking at runtime by being passed as a prop
  to a Client Component, logged, or returned in an error payload. Code review and the Data Access
  Layer pattern are the controls there.
- **The value scan depends on `SECRET_SENTINEL`.** Without it during the build, only the
  `YOUTUBE_API_KEY` name check runs. A future `NEXT_PUBLIC_YOUTUBE_API_KEY` would also not be
  caught by the name check (different literal) and would only be caught by the value scan.
- **The T08 result was partly vacuous.** At that commit `src/lib/env.ts` was imported by
  `src/lib/errors.ts`, which nothing in `src/app` or `src/components` imported yet, so the env
  module (and any key handling) was not in the built graph. The re-check below scans a larger build
  whose server output does contain the YouTube client (see below).
- **YouTube client unverified at the time.** `src/lib/youtube/client.ts` did not exist on
  `9562733`, so its `server-only` marker and import boundary were unconfirmed. The marker is
  verified in the re-check below; the import boundary has not been re-reviewed.
- Source maps are not emitted into `.next/static` today. The script would scan them if they were,
  but maps emitted outside that directory would not be covered.

## Current re-check — 10 November 2026 (commit `0d75f5c`, HEAD at the time)

Only the checks listed here were re-run. The `.next/static` directory was produced by a `next build`
already present in this workspace; no source file was changed for this re-check, and the planted-leak
negative control was not repeated.

### Bundle scan

```powershell
$env:SECRET_SENTINEL='AIzaSySENTINEL_DO_NOT_USE_000000000'
npm run check:secrets
```

```text
check-secrets: scanning .next\static
check-secrets: PASS — scanned 34 file(s) (923085 bytes) in .next\static; neither "YOUTUBE_API_KEY" nor the SECRET_SENTINEL value is present.
```

The file count rose from 25 to 34 as routes and client components landed. The scan is still
client-bundle only, and every residual risk above still applies.

The build behind this run is not the minimal T08 build: `.next/server/app` contains the search,
trending, video, watch, library and category routes, and `YOUTUBE_CACHE_DISABLED` appears in
`.next/server/chunks/src_lib_youtube_client_ts_*.js`, so the YouTube client is in the compiled
server graph. That is what makes the client-bundle scan meaningful this time.

### Server-only markers

`Select-String` over the modules that read the key or the database finds the marker in all four
modules [`ARCHITECTURE.md`](ARCHITECTURE.md) relies on:

| Module                                          | Marker  |
| ----------------------------------------------- | ------- |
| `src/lib/env.ts`                                | line 13 |
| `src/lib/db/client.ts`                          | line 51 |
| `src/lib/youtube/client.ts`                     | line 73 |
| `src/lib/db/repositories/library.repository.ts` | line 64 |

`NEXT_PUBLIC_` still appears nowhere in `src/` except the wording inside `src/lib/env.ts` and in test
assertions that quote that message. The Client Component import graph was not re-reviewed, so the
T08 conclusion about it should be treated as unverified for the current tree.
