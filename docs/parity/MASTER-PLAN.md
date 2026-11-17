# Parity master plan — YouTube Experience Spec v1 → Viewly

Status: active
Owner: REA + owner review
Specs: `docs/specs/` (one JSON contract + one Markdown spec per flow)
Reports: `docs/parity/<flow>-report.md`
Evidence: `docs/re-evidence/<flow>/` (local only, git-ignored)

## 1. Where we are

- Four flows captured and specced at 0.1.0: `home`, `search`, `channel`, `watch` (38 contract assertions, 9 documented gaps).
- 1,400+ local artefacts across the four flows, redaction-audited.
- Viewly's product code is still v0.2.1: none of the parity work is visible in the app yet.
- `npm test`, `typecheck` and `format:check` are green (contract gaps are `it.fails` markers).

## 2. The gap that matters

The largest distance is not missing controls; it is **shape**:

| Surface | Observed YouTube                                                           | Viewly today                               |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| shell   | 56px masthead with centred search, 72px icon rail, chip bar                | sidebar app shell, search inside pages     |
| home    | chip bar + 3/2/1 card grid, 16:9 cards with 36px avatars and 2-line titles | hero + category links + horizontal shelves |
| search  | wide result rows (500px thumb, text at x=612) + chips + filters panel      | uniform card grid + inline selects         |
| channel | banner, 160px avatar, tab bar, shelves                                     | identity card + recent-uploads grid        |
| watch   | 873px player column + 344px rail                                           | already close: player column + 360px rail  |

Decision (owner: "look professional like youtube.com"): adopt the observed **layout and
interaction patterns**, keep Viewly's own brand and data, never copy logos, artwork, copy or
identifiers, and stay ad-free.

## 3. Principles

1. Behaviour first, appearance second, but both are specified and measured.
2. Every visible change is backed by a spec claim and a contract test; gaps flip from `it.fails`
   to enforced as they land.
3. No ads, no YouTube copy, no account surfaces, official embed only, attribution retained.
4. One theme: a dark YouTube-like surface (`#0f0f0f` page, raised cards, `#f1f1f1` primary text,
   `#aaaaaa` secondary) while keeping the Midnight Purple accent for Viewly-owned affordances.
5. Each phase ends green (tests, types, format) and committed; parity reports are updated in the
   same commit.

## 4. Phases

### P0 — close the spec sweep for the core (done when committed)

- `watch` contracts + parity report + master plan (this document).

### P1 — design system and shell

- Tokens: dark surface, text/raised layers, 56px masthead, 72px guide rail, 32px chips.
- Masthead: brand, centred search field, account entry (no auth), no ads.
- Guide rail: Home, Shorts, Subscriptions, You equivalents mapped to Viewly routes; mobile bottom
  navigation retained.
- Acceptance: shell is one labelled masthead + one primary nav; skip link first; 56px masthead and
  72px rail at 1280, hidden rail and top bar at 390; tests green.

### P2 — home

- Replace the hero with a chip bar + responsive feed grid (3/2/1 columns; 16/36px gaps).
- Card: 16:9 thumbnail (12px radius), duration badge, 2-line title (16/22, 500), 36px avatar with
  initial fallback, channel name, views + publish age, overflow action.
- Overflow menu: add to playlist, save to watch later, copy link, open on YouTube; Escape returns
  focus to the trigger.
- States: skeleton grid on load, authored empty and error states, chip refilter.
- Acceptance: home contract gaps (`/` shortcut, publish age, card menu) flip; grid matches the
  measured anchors within a few px; no layout shift on load.

### P3 — search

- Result rows: 500px 16:9 thumbnail, text column, 2-line title (18/26), metadata (12/18),
  2-line description, per-row overflow.
- Chip row (all / videos / live / recently uploaded), clear-query control, filters as the existing
  inline selects (deviation kept: no modal), load-more as an explicit control.
- Acceptance: search contract gaps (clear-query, chips, row menu) flip; rows collapse to cards at
  390 with the same information order.

### P4 — channel

- Header: banner strip, 120–160px avatar, name, counts, description with expander, subscribe
  replaced by "Open on YouTube" + save actions (no accounts).
- Tabs: Home and Videos (short-form/live/playlists only when data exists), tab bar 48px.
- Home: featured video + titled shelves; Videos: grid + sort chips (latest/popular/oldest).
- Acceptance: channel contract gaps (tabs, sort chips) flip; 3/2/1 grid geometry matches.

### P5 — watch alignment

- Player column 873px at 1280, rail 344px, 16px gap; title 20/28 600; action row 40px controls.
- Keep the official embed, theatre, queue, notes and listen mode untouched.
- Acceptance: measured anchors match; watch contracts stay green; player-ready budget measured.

### P6 — freeze and verify

- Run all contract suites, flip gap markers that passed, update every parity report with new counts.
- Visual QA at 390/768/1280 against the spec's screenshots; fix the top three visual mismatches.
- Acceptance: core flows (home, search, channel, watch) at ≥90% contract parity or documented
  deviations with reasons; suite green; build green.

### P7 — remaining flows (after the visible core)

- Workstream B remainder: `watch-description`, `watch-comments`, `watch-queue`.
- Workstream C: `player-chrome`, `shortcuts`, `theater`, `listen`, `mini-player`.
- Workstream D: `history`, `playlists`, `continue-watching`.
- Workstream E: `loading/error/empty` system pass, `a11y`, `perf budgets`.
- Each flow follows the same loop: capture → spec → G2 → contracts → report → commit.

## 5. Quality gates (every phase)

```bash
npm test
npm run typecheck
npm run format:check
npm run lint
```

Plus: no ads, no YouTube marks or copy in code, official embed intact, attribution links retained,
three-width visual check, and a parity report delta.

## 6. Risks and mitigations

| Risk                                                           | Mitigation                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Scope: 12 flows at this depth is weeks of capture              | Core four first; remaining flows scheduled after visible parity                       |
| Class-name assertions are brittle                              | Prefer roles/labels/structure; class checks only where the stylesheet is the contract |
| Dark YouTube-like theme clashes with the Midnight Purple brand | Keep the brand accent for Viewly-owned actions; neutrals follow the spec              |
| Regressions in library, player, queue                          | Never touch those flows' logic in P1–P5; contracts + existing suite guard them        |
| Ads/promoted content differ per session                        | Specs describe patterns, not inventory; Viewly stays ad-free                          |
| Evidence is large and local                                    | Manifest + redaction audit per flow; directories are disposable                       |

## 7. Definition of done for the visible milestone

1. Shell, home, search, channel and watch match the measured layout anchors at 390/768/1280.
2. All four contract suites green with the nine `it.fails` markers either flipped or explicitly
   accepted as deviations in their reports.
3. No ads, no copied branding, official embed, attribution links present.
4. `npm test`, `typecheck`, `format:check`, `lint` green; production build succeeds.
5. Parity dashboard facts available from the four reports.

## Change log

- 2026-11-17 — plan created; watch flow closed at spec 0.1.0.
- 2026-11-17 — P1 (tokens, masthead, rail) and P2 (grid, card, menu, age, shortcut) landed; 121 test files green, 3 home + 2 search gaps closed.
- 2026-11-17 — P3 search wide rows, chip shortcuts and row skeletons landed; suite green.
