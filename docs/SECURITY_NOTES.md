# Security Notes

Owner: Victoria (Security Engineer). This file records security checks that were actually run, with
the commands and their output, so the evidence can be re-verified. Do not add a check here that has
not been executed.

Baseline for this note: commit `9562733`, Next.js 16.4.5 (Turbopack), Node v24.21.0, Windows /
PowerShell. The working tree also contained other agents' in-progress changes (`src/db/**`,
`src/lib/youtube/probe.test.ts`, `tests/schema.test.ts`); none of them were modified by this check.

## T08 — API key isolation and server-only boundaries

### What was checked

1. Server-only markers on every module that reads the YouTube key:
   - `src/lib/env.ts:13` — `import "server-only";` (first import, after the module doc comment).
   - `src/lib/db/client.ts:51` — `import "server-only";` (first import).
   - `src/lib/youtube/client.ts` — **not present at the time of this check.** The folder contained
     `.gitkeep` and `probe.test.ts` (Alex's in-progress work); the client itself had not landed, so
     its marker could not be verified. Re-check when it exists.
2. Import graph: no Client Component imports these modules. The only `"use client"` files in `src/`
   are `src/app/error.tsx` and `src/components/layout/nav-links.tsx`; neither imports `lib/env`,
   `lib/db/client`, or `lib/youtube`. Repo-wide, the only importers of `@/lib/env` are
   `src/lib/errors.ts` (a server module) and the unit tests; `@/lib/db/client` is imported only by
   its own test. `lib/youtube` has no importers yet.
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

Independent grep, not using the script:

```powershell
$files = Get-ChildItem -Recurse -File .next/static
$files | Select-String -SimpleMatch 'YOUTUBE_API_KEY'
$files | Select-String -SimpleMatch 'AIzaSySENTINEL_DO_NOT_USE_000000000'
```

- `YOUTUBE_API_KEY`: no matches.
- `AIzaSySENTINEL_DO_NOT_USE_000000000`: no matches.
- `.next/static` contained 25 files and no `.map` source maps.
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
- **The current green result is partly vacuous.** `src/lib/env.ts` is imported by
  `src/lib/errors.ts`, which nothing in `src/app` or `src/components` imports yet, so the env
  module (and any key handling) is not in the built graph today. Re-run this check when the YouTube
  client (T13) and route code land.
- **YouTube client unverified.** `src/lib/youtube/client.ts` does not exist yet, so its
  `server-only` marker and import boundary remain unconfirmed. This note must be revisited once it
  lands, and the `check:secrets` run repeated then.
- Source maps are not emitted into `.next/static` today. The script would scan them if they were,
  but maps emitted outside that directory would not be covered.
