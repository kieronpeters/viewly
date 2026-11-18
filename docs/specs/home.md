# Home

Surface: web (signed-out, responsive at 390 / 768 / 1280)
Captured: 2026-11-17
Evidence: `docs/re-evidence/home/`
Spec version: 0.1.0
Status: draft — awaiting G2 review
Machine contract: [`home.json`](home.json)

## Purpose

The home surface is the default destination of the product: a shell (masthead, optional guide
rail, filter chip bar) wrapped around a vertical feed of video cards. It is the surface a new
visitor lands on before they have expressed any intent, so it must work with no history at all,
explain itself when there is nothing to show, and degrade without pretending a failure is an
empty feed. This spec describes the behaviour and the measurable appearance of that surface as
observed in a public, signed-out browser session.

## Method and confidence

- Chrome 157, one fresh signed-out profile per run, one page per run, viewports 390×844,
  768×1024 and 1280×800, device pixel ratio 1. No login, no private endpoint, no media capture.
- The feed was made non-empty only through human-paced public activity: two visits to public
  search results, then the first result. Nothing else was automated.
- Per state: DOM snapshot, accessibility tree, screenshot, and in-page navigation/paint/LCP/CLS/
  long-task entries. Interaction latency is wall-clock from input dispatch to the observed change.
- All timings are ranges over the samples listed in the table. A single sample is marked `n=1`
  and should not be treated as a distribution.
- Network is recorded as path plus parameter names only; values, cookies and auth headers are
  never read. See `docs/re-evidence/home/MANIFEST.md`.
- Environment note: in this session several ad-tracking XHRs were blocked and media requests
  returned 403, and no application error was logged during the ready state
  (`1280/r3/console.json`). That is an artefact of the capture environment, not a behaviour of
  the surface.

## Entry points

- Direct navigation to `/`.
- Returning to `/` from another route in the same session.
- The brand link in the masthead, and the first guide destination.
- Not observed: entry with a signed-in session, entry with a consent interstitial, deep links
  carrying a filter selection.

## States

| State        | Trigger                                            | What the user sees                                                                                                                                                        | Recovery                    |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| loading      | feed request in flight after a client-side refresh | shell retained; the grid is replaced by skeleton tiles (16:9 block, 36px avatar circle, two text bars) plus a centred indeterminate spinner; no text, no error copy       | automatic                   |
| ready        | feed resolves with at least one item               | one selected filter chip and a chip row; card grid at 3/2/1 columns; cards with thumbnail, duration badge, title, channel avatar/name, view/age metadata, overflow action | —                           |
| empty        | signed-out visitor with no local activity          | authored panel replacing the grid: short heading plus one sentence inviting search or watching; centred, raised surface, 12px radius; chip bar absent; shell retained     | search or watch a video     |
| error        | feed request fails                                 | skeleton tiles first, then the same authored panel as empty; no error copy, no alert, no retry affordance at 4s or 12s                                                    | none offered                |
| offline cold | first navigation with no network                   | browser-owned network error page; the app document is never reached                                                                                                       | browser retry / reconnect   |
| offline warm | network lost after the feed rendered               | no visual change and no alert when another feed action is attempted; the previously rendered cards remain                                                                 | none offered; stale content |
| disabled     | signed-out session                                 | no create or notifications controls; the account area is a sign-in call to action; guide holds only public destinations; account-adjacent card actions are still listed   | not applicable              |

Evidence: `1280/r1/state-loading.*` (107 skeleton elements), `1280/r3/ready.*`, `1280/empty/state-empty.*`,
`768/empty/state-empty.*`, `390/empty/state-empty.*`, `1280/cold-error/cold-state.json`,
`390/cold-error/cold-state.json`, `1280/cold-offline/cold-state.json`, `1280/r3/offline.json`,
`1280/r3/keyboard.json`, `1280/r3/menu-items.json` (all 2026-11-17).

Two behaviours are worth calling out because they are easy to get wrong in a re-implementation:

1. **A failed feed does not surface an error.** The skeleton is shown, then the empty panel. The
   user cannot tell a failure from a genuinely empty feed, and there is no retry control to
   recover. The observed evidence is `1280/cold-error` at 4s and 12s, and `390/cold-error` at 4s
   (skeletons) and 12s (empty panel).
2. **Warm offline fails silently.** With the feed already rendered, an action that needs the
   network leaves the old cards in place and raises no alert (`1280/r3/offline.json`).

## Controls

| Control            | Keyboard        | Pointer | ARIA / name           | Behaviour                                                                                                        |
| ------------------ | --------------- | ------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| guide toggle       | Enter, Space    | click   | button "Guide"        | toggles the rail between 72px and a 240px drawer; full width in ~0.4s                                            |
| brand link         | Enter           | click   | link                  | returns to `/`                                                                                                   |
| skip navigation    | Tab, Enter      | click   | button                | off-screen until focused; third stop in the desktop tab order                                                    |
| search field       | `/`, Tab, Enter | click   | combobox              | inline field at ≥656px; pressing `/` focuses it; at 390 it is an icon button that opens search                   |
| search submit      | Enter           | click   | button "Search"       | submits the query                                                                                                |
| voice search       | Enter           | click   | button                | present at ≥656px; absent at 390                                                                                 |
| settings           | Enter           | click   | button                | opens the settings entry point                                                                                   |
| sign-in entry      | Enter           | click   | link "Sign in"        | out of scope; never followed                                                                                     |
| guide destinations | Tab, Enter      | click   | links                 | four public destinations, 56px rows with icon + label                                                            |
| filter chips       | Tab, Enter      | click   | role=tab              | exactly one selected; selecting another replaces the feed in place, no route change; the rail scrolls with focus |
| video card         | Tab, Enter      | click   | link                  | thumbnail and title form one link target to the watch route                                                      |
| card overflow      | Enter, Escape   | click   | button "More actions" | opens three account-adjacent actions; Escape closes and returns focus to the trigger                             |
| infinite scroll    | End, PageDown   | scroll  | —                     | appends more cards; the grid is virtualised, so DOM item counts are not monotonic                                |

Evidence: `1280/r3/keyboard.json`, `390/r3/keyboard.json`, `1280/r3/menu.json`,
`1280/r3/menu-items.json`, `768/r3/menu.json`, `390/r3/menu.json`, `1280/r3/chip.json`,
`768/r3/chip.json`, `390/r3/chip.json`, `1280/r3/guide.json` (2026-11-17).

## Events and timings

| Event                        | From → To                   | Measured range | n   | Evidence                                   |
| ---------------------------- | --------------------------- | -------------- | --- | ------------------------------------------ |
| server response start        | navigation                  | 136–215 ms     | 3   | `1280/r1`, `1280/r2`, `390/r1` timing.json |
| DOMContentLoaded             | navigation                  | 2091–2356 ms   | 3   | same                                       |
| load event end               | navigation                  | 2140–2403 ms   | 3   | same                                       |
| first paint                  | navigation                  | 1840–2312 ms   | 4   | same incl. `768/r1`                        |
| first contentful paint       | navigation                  | 1840–2688 ms   | 4   | same                                       |
| largest contentful paint     | navigation                  | 2416–5380 ms   | 4   | same                                       |
| cumulative layout shift      | navigation                  | 0.0003–0.0128  | 3   | same                                       |
| longest main-thread task     | navigation                  | 0–952 ms       | 3   | `1280/r1/timing.json`                      |
| card menu open               | click → menu visible        | 30–39 ms       | 5   | `1280/r3`, `768/r3`, `390/r3` menu.json    |
| card menu close              | Escape → menu gone          | 48–51 ms       | 2   | `1280/r3`, `768/r3` menu.json              |
| chip filter first change     | click → different feed      | 118–123 ms     | 4   | chip.json (four runs)                      |
| chip filter settled          | click → stable feed         | 896–1899 ms    | 4   | chip.json (four runs)                      |
| infinite scroll first append | scroll to end → new content | 509–865 ms     | 5   | scroll.json (five runs)                    |
| guide drawer open            | click → 240px rail          | 401 ms         | 1   | `1280/r3/guide.json`                       |

The navigation numbers describe one machine and one network on 2026-11-17; they are useful as a
budget anchor, not as a constant. The interaction numbers are stable across the three viewports,
which is the useful part: a menu that opens in ~35ms and a filter that settles inside ~2s.

## Layout and appearance

Measured anchors, so a re-implementation can match or deliberately beat them.

| Viewport | Columns | Content inset | Card width | Thumbnail | Column gap | Row gutter |
| -------- | ------- | ------------- | ---------- | --------- | ---------- | ---------- |
| 390      | 1       | 20px          | 335px      | 335×188   | —          | 36px       |
| 768      | 2       | 24px          | 345px      | 345×194   | 16px       | 36px       |
| 1280     | 3       | 96px          | 371px      | 371×209   | 16px       | 36px       |

- Masthead 56px on every viewport. The chip bar is a 56px row directly below it (chips 32px tall,
  12px apart). The grid begins 24px below the chip bar (`y=136` at all three widths).
- At 1280 the guide rail occupies 72px, so the content inset is 72 + 24. At 768 and 390 there is
  no rail and the inset is 24 / 20. The 390 layout has no inline search field and no bottom
  navigation bar.
- Page surface `rgb(15, 15, 15)`, type stack `Roboto, Arial, sans-serif`.
- Card: 16:9 thumbnail with a 12px radius; duration badge 12/18 medium white, 18px tall, inset
  12px from the right and 9px from the bottom of the thumbnail; 12px below the thumbnail a row
  with a 36px circular avatar and a 8px gap, then a title column clipped to two lines.
- Title: 16px / 22px, weight 500, `rgb(241, 241, 241)`, 24px right padding for the overflow
  button. Metadata: 14px / 20px, weight 400, `rgb(170, 170, 170)`.
- Shelves are horizontal rows below the first grid rows: 1145px wide, first one starting at
  `y=1210` at 1280.
- Empty panel: centred, ~700×100 at 1280, 12px radius, raised surface; the heading occupies one
  299×29 line and the body one 403×17 line. At 390 the heading wraps to 215×61 and the body to
  294×37, so the panel must be allowed to grow vertically.

Evidence: `1280/styles2/styles-deep.json`, `390/styles2/styles-deep.json`,
`1280/r3/ready.dom.json`, `768/r3/ready.dom.json`, `390/r3/ready.dom.json`,
`1280/empty/state-empty.dom.json` (2026-11-17).

## Accessibility

- Focus order at 1280 (16 measured stops): guide toggle → brand link → skip navigation → search
  field → search submit → voice search → settings → sign-in → four guide destinations → first
  four chips.
- Focus order at 390 (8 measured stops): guide toggle → brand link → skip navigation → search
  icon → settings → sign-in → first two chips.
- The skip link exists in the DOM off-screen (`y=-989`) and becomes visible on focus; it is the
  third stop, not the first.
- Focus is visible: the focused masthead control draws a white rounded indicator
  (`shots/kbd-01-first-tab.png`).
- Opening a card menu and pressing Escape returns focus to the overflow button that opened it.
- Measured roles per page: 1 combobox, 21 tabs, 58 buttons, 57 links, 32 headings, 1 banner,
  1 navigation, 1 main; 1829–1933 accessibility nodes, 734–814 ignored.
- Chips are named by their visible text and expose a selected state; Tab moves through them and
  the rail scrolls to keep the focused chip visible.
- Reduced motion: no running CSS animations were reported and the probed chip transition is 0s,
  both normally and with `prefers-reduced-motion: reduce`; there is little for the preference to
  suppress. The inline preview's own motion could not be observed, so that part is a gap.

Evidence: `1280/r3/keyboard.json`, `390/r3/keyboard.json`, `1280/r3/menu.json`,
`1280/r3/reduced-motion.json`, `1280/r3/ready.ax.json` (2026-11-17).

## Gaps and unknowns

1. **Signed-in home is unobserved.** Personalised feed, subscriptions, notifications and create
   require an account session, which the guardrails exclude.
2. **Inline preview on hover is unconfirmed.** Three dedicated runs produced no preview; media
   requests returned 403 in this environment, and one earlier probe saw a playing element at
   ~0.71s. The behaviour likely exists but its delay cannot be stated as a range.
3. **No authored error state exists on this surface.** Observed only skeleton → empty panel, with
   no retry. A different failure class or a longer wait might surface something else.
4. **First-load loading state is uncertain.** Holding the feed XHR paused the skeleton on a warm
   reload, but no feed XHR was paused on a cold first navigation, which suggests the initial feed
   is server-rendered.
5. **Mobile bottom navigation is unconfirmed.** At 390 with a desktop user agent no bottom bar
   rendered; a real phone user agent may differ because device emulation was not used.
6. **Chip arrow-key behaviour was not measured.** Only Tab and Enter were exercised.
7. **Shelf controls were not exercised.** Shelves were located and measured, but their arrows and
   see-all behaviour were not.
8. **Promoted tiles are not reproducible on demand.** They appeared in several runs with a
   sponsor line and two call-to-action buttons; the pattern is described, the inventory is not.
9. **Exact empty-panel tokens are approximate.** Geometry is measured from the snapshot; the
   surface colour and type scale are read from the screenshot because the card-oriented style
   probe did not target that component.
10. **Region, locale and experiment assignment are uncontrolled.** Chip taxonomy and promoted
    content vary by assignment; one region and one locale were observed.
11. **Account-adjacent card actions were not followed.** Queue, playlist and save actions appear
    signed out but lead to an auth surface the guardrails exclude.

## Deviations in Viewly

None recorded yet. No Viewly code was changed in this task, and no contract tests exist before
the G2 freeze. Deviations will be recorded in `home.deviations.md` when the implementation gate
opens.

## Evidence index

| Artefact                                                                                 | Supports                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `1280/r3/`, `768/r3/`, `390/r3/`                                                         | ready state, controls, focus order, interaction timings |
| `1280/styles2/`, `390/styles2/`                                                          | appearance: type scale, colour, radii, geometry         |
| `1280/empty/`, `768/empty/`, `390/empty/`                                                | empty state and panel geometry                          |
| `1280/cold-error/`, `390/cold-error/`                                                    | error behaviour (skeleton → empty panel, no retry)      |
| `1280/cold-offline/`                                                                     | cold offline = browser error page                       |
| `1280/r3/offline.json`                                                                   | warm offline = silent stale content                     |
| `1280/r1/state-loading.*`                                                                | loading skeleton                                        |
| `1280/r1/timing.json`, `1280/r2/timing.json`, `768/r1/timing.json`, `390/r1/timing.json` | navigation budgets                                      |
| `MANIFEST.md` / `MANIFEST.json`                                                          | capture method, artefact digests, redaction audit       |

## Change log

- 0.1.0 (2026-11-17) — initial draft from the signed-out capture at 390/768/1280.

## Deliberate deviations (2026-11-18)

- The chip row navigates to `/category/<slug>` rather than filtering the home
  feed in place. The observed surface keeps an "All" chip selected; Viewly shows
  selection on the category page instead. Recorded in the parity report.
