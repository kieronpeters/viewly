# REA capture harness

Headless-Chrome capture tools used to produce the evidence behind the specs in
`docs/specs`. The harness is committed so the pipeline survives a fresh clone;
captured evidence itself stays git-ignored under `docs/re-evidence/`.

## Requirements

- Chrome/Chromium reachable locally (the script launches its own instance).
- A writable output directory per run.
- Run it unsandboxed on Windows: Chrome's crashpad handler needs process access.

## Commands

```bash
# one page at one width (start URL from the environment)
REA_START_URL="https://www.youtube.com/" node scripts/rea/capture.mjs \
  --width 1280 --height 800 --out docs/re-evidence/home/1280 --steps baseline

# then normalise URLs/tokens and write the manifest
node scripts/rea/sanitize.mjs docs/re-evidence/home/1280
node scripts/rea/manifest.mjs docs/re-evidence/home
```

On Windows PowerShell:

```powershell
$env:REA_START_URL = "http://localhost:3000/"
node scripts/rea/capture.mjs --width 390 --height 844 --out docs/re-evidence/local/390 --steps baseline
Remove-Item Env:\REA_START_URL
```

## Guardrails

- Capture public, signed-out surfaces only. Never capture a logged-in session,
  private endpoints, or anything requiring the owner's cookies.
- `sanitize.mjs` strips media signatures, ad tokens, image-proxy paths and
  `data:` payloads; `manifest.mjs` hashes every artefact and audits the result.
  Run both before using evidence in a spec.
- Everything under `docs/re-evidence/` is disposable and never committed.
