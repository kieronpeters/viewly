# Search

Surface: web (signed-out, responsive at 390 / 768 / 1280)
Captured: 2026-11-17
Evidence: `docs/re-evidence/search/`
Spec version: 0.1.0
Status: draft — awaiting G2 review
Machine contract: [`search.json`](search.json)

## Purpose

The search surface turns a typed query into a ranked, filterable list of destinations: videos,
channels, playlists, short-form items and promoted tiles. It is the second surface a new visitor
uses, and the one where the cost of a wrong state is highest: a failed refinement must not look
like "no results", and an empty query must not look like a network failure. This spec describes
the observable behaviour and appearance of that surface in a public, signed-out session.

## Method and confidence

- Chrome 157, one fresh signed-out profile per run, viewports 390×844, 768×1024 and 1280×800,
  device pixel ratio 1. Public results route only; no login, no private endpoint, no media capture.
- Queries were generic topics. No personal data was used as a query, and the query string is
  recorded only in redacted form.
- Per state: DOM snapshot, accessibility tree, screenshot, and in-page navigation/paint/LCP/CLS/
  long-task entries. Interaction latency is wall-clock from input dispatch to observed change.
- Timings are ranges over the samples listed; navigation timings are a **single sample** and are
  labelled as such. They are not a distribution.
- Environment note: this network enforces Restricted Mode, so the page carried a notice that some
  results were removed administratively. Result composition is therefore not representative of an
  unrestricted session (`1280/r2/state-ready.dom.json`).

## Entry points

- Submitting the masthead query field from any surface.
- Direct navigation to `/results?search_query=<terms>`.
- Returning to a results URL from history or a link.
- Not observed: search entered from the short-form surface, voice search, or a signed-in session.

## States

| State        | Trigger                                       | What the user sees                                                                                                                      | Recovery       |
| ------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| loading      | refinement (chip change) after results are up | shell and chip bar stay; the selected chip moves immediately; the list becomes skeleton rows (43 skeleton elements, no rows, no images) | automatic      |
| ready        | query resolved                                | chips with one selected, a Filters control, and a mixed list of promoted tiles, channel cards, shelves, short-form items and video rows | —              |
| empty        | query with no matches                         | **not observed**: random strings still produced a spelling suggestion plus suggested results                                            | unknown        |
| error        | refinement request fails                      | **not surfaced**: server-rendered results stay, no alert, no retry                                                                      | none offered   |
| offline warm | chip change while offline                     | the previous results stay on screen; no alert                                                                                           | none offered   |
| offline cold | navigation while offline, shell cached        | authored offline panel: no-connection heading, guidance to connect, shell still visible                                                 | reconnect      |
| disabled     | signed-out session                            | no account-only controls; the channel card offers a subscribe action that leads to an auth surface (not followed)                       | not applicable |

Evidence: `1280/r2/state-loading-chip.*`, `1280/r2/state-ready.*`, `768/r1/state-ready.*`,
`390/r1/state-ready.*`, `1280/r3/empty.json`, `1280/r3/error.json`, `1280/r3/offline.json`,
`1280/r3/shots/state-offline-cold.png` (2026-11-17).

Two behaviours matter for a re-implementation:

1. **A failed refinement does not surface an error.** The list keeps the previous results and no
   retry appears. Offline is the same: stale results persist silently.
2. **A query with no matches is not an empty panel.** The observed fallback is a spelling
   suggestion plus suggested content, so "nothing found" is communicated as "here is something
   adjacent" rather than as a blank state.

## Result composition

A results page is not a uniform list. In one page the following appeared, in this order:

- a promoted tile with a sponsor line and call-to-action buttons;
- a channel card (avatar, name, handle, subscriber count, description, subscribe action);
- a channel content shelf ("latest from …") with its own load-more control;
- a short-form shelf: a horizontal row of vertical items;
- video rows: thumbnail, two-line title, view/age metadata, channel avatar and name, two-line
  description, badges, overflow action;
- a load-more control at the end of each list.

Evidence: `1280/r2/state-ready.dom.json`, `1280/r2/shots/state-ready.png`,
`390/r1/shots/state-ready.png` (2026-11-17).

## Controls

| Control        | Keyboard        | Pointer | ARIA / name              | Behaviour                                                                                     |
| -------------- | --------------- | ------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| query field    | Tab, Enter      | click   | combobox                 | prefilled with the current query; submitting navigates to the results route                   |
| clear query    | Enter           | click   | "Clear search query"     | empties the field; present only when a query exists                                           |
| submit search  | Enter           | click   | "Search"                 | submits the query                                                                             |
| voice search   | Enter           | click   | "Search with your voice" | not exercised                                                                                 |
| filter chips   | Tab, Enter      | click   | role=tab, one selected   | six chips; refilters in place without a route change; row scrolls, overflow arrow when narrow |
| filters panel  | Tab, Enter, Esc | click   | "Search filters"         | five groups; opens in ~0.14s; Escape closes in ~0.04s and returns focus to the trigger        |
| result row     | Tab, Enter      | click   | link                     | thumbnail and title open the watch route; overflow action beside them                         |
| row overflow   | Enter           | click   | button                   | opens the row's action menu (behaves as on the home surface)                                  |
| channel action | Enter           | click   | button                   | leads to an auth surface; out of scope                                                        |
| short-form row | Tab, Enter      | click   | link                     | opens the short-form surface                                                                  |
| load more      | Tab, Enter      | click   | button                   | appends rows; explicit control, not infinite scroll                                           |

Filter groups observed: type (videos, short-form, channels, playlists, movies), duration, upload
date, features (live, 4K, HD, subtitles/CC, creative commons, 360°, VR180) and prioritisation.

Evidence: `1280/r2/keyboard.json`, `1280/r2/filters.json`, `1280/r2/shots/filters-open.png`,
`1280/r2/chip.json`, `1280/r4/more.json` (2026-11-17).

## Events and timings

| Event                      | From → To                 | Measured range | n   | Evidence                  |
| -------------------------- | ------------------------- | -------------- | --- | ------------------------- |
| filters panel open         | click → panel visible     | 135–150 ms     | 3   | filters.json (three runs) |
| filters panel close        | Escape → panel gone       | 36–48 ms       | 2   | filters.json              |
| chip refilter first change | click → different results | 551–720 ms     | 3   | chip.json                 |
| chip refilter settled      | click → stable results    | 1474–1785 ms   | 3   | chip.json                 |
| load more                  | click → new rows          | 345–806 ms     | 3   | more.json                 |
| first contentful paint     | navigation                | 5748 ms        | 1   | `1280/r2/timing.json`     |
| largest contentful paint   | navigation                | 7880–8800 ms   | 1   | `1280/r2/timing.json`     |
| DOMContentLoaded           | navigation                | 7988 ms        | 1   | `1280/r2/timing.json`     |
| load event end             | navigation                | 9366 ms        | 1   | `1280/r2/timing.json`     |
| cumulative layout shift    | navigation                | 0              | 1   | `1280/r2/timing.json`     |
| longest main-thread task   | navigation                | 985 ms         | 1   | `1280/r2/timing.json`     |

The single navigation sample is slow (a search page pulls many resources); treat it as an upper
bound observed once, not as a budget.

## Accessibility

- Focus order at 1280: brand link → skip navigation → query field → clear query → submit search →
  voice search → settings → sign-in → guide destinations → first four chips.
- Focus order at 390: brand link → skip navigation → search icon → settings → sign-in → all six
  chips → filters.
- Chips expose the `tab` role with a selected state; six tabs were present.
- The filters trigger is named ("Search filters"), and Escape returns focus to it.
- The skip link stays in the tab order; the shell keeps one main content target.
- Measured roles on one page: 86 links, 58 buttons, 29 headings, 6 tabs, 30 images; 2578
  accessibility nodes, 830 ignored.
- Reduced motion: no running CSS animations were reported, before or under
  `prefers-reduced-motion: reduce` (0 and 0).

Evidence: `1280/r2/keyboard.json`, `390/r1/keyboard.json`, `1280/r2/filters.json`,
`1280/r2/state-ready.ax.json`, `1280/r2/reduced-motion.json` (2026-11-17).

## Appearance

| Element         | 1280 desktop                                   | Narrow                                |
| --------------- | ---------------------------------------------- | ------------------------------------- |
| content column  | x=96, width 1145                               | x=24 at 768 and 390                   |
| result row      | 1145×281                                       | 705×255 at 768, 327×246 at 390        |
| thumbnail       | 500×281, 12px radius                           | fills the row's media column          |
| title           | 18/26, weight 400, `rgb(241,241,241)`, 2 lines | same type scale                       |
| metadata        | 12/18, `rgb(170,170,170)`                      | same                                  |
| description     | 12/18, `rgb(170,170,170)`, 2 lines             | same                                  |
| chip            | 32px tall, 12px gaps, top at 67px              | single scrolling row + overflow arrow |
| filters control | 101×40, right-aligned in the content column    | same                                  |
| short-form item | 216×324                                        | 160×239 at 390                        |
| page            | `rgb(15,15,15)`, Roboto/Arial                  | same                                  |

Text starts at x=612 in the 1280 row, i.e. a 500px media column followed by a 16px gutter.
Evidence: `1280/r2/search-styles.json`, `1280/r2/state-ready.dom.json`,
`768/r1/state-ready.dom.json`, `390/r1/state-ready.dom.json` (2026-11-17).

## Gaps and unknowns

1. **Empty state is unobserved.** Random strings produced a spelling suggestion plus suggested
   results; no query or filter combination yielding zero results was found.
2. **Error state is unobserved.** Refinements are background requests; blocking them leaves the
   server-rendered page intact with no alert or retry.
3. **Restricted Mode is enforced by this network.** Some results were removed administratively;
   composition is not representative of an unrestricted session.
4. **Filter option selection was not exercised.** Only panel open/close, grouping and focus return
   were measured.
5. **Initial-load skeleton is unconfirmed.** The initial response is server-rendered; the skeleton
   was only seen on a client-side refinement.
6. **Signed-out account actions were not followed.** Subscribe and similar controls lead to auth.
7. **Mobile thumbnail dimensions are partial.** Below-fold thumbnails are lazy; row boxes are
   measured, every image box is not.
8. **The query field's accessible name was not resolved** during the focus walk.
9. **Voice search was not attempted** (microphone and speech input).
10. **End-of-list behaviour was not reached.** Load-more was measured, the terminal state was not.
11. **Region, locale and experiment assignment are uncontrolled.**

## Deviations in Viewly

None recorded yet. No Viewly code was changed for this flow and no contract tests are written
before the G2 freeze. Deviations will be recorded in `search.deviations.md` when the
implementation gate opens.

## Evidence index

| Artefact                                         | Supports                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| `1280/r2/`, `768/r1/`, `390/r1/`                 | ready state, focus order, filters, chip timing, styles |
| `1280/r2/state-loading-chip.*`                   | refinement skeleton                                    |
| `1280/r3/empty.json`                             | empty-state miss (suggestion fallback)                 |
| `1280/r3/error.json`                             | error-state miss (no alert)                            |
| `1280/r3/offline.json`, `state-offline-cold.png` | warm silence and the cold offline panel                |
| `1280/r4/`, `768/r4/`, `390/r4/`                 | load-more latency                                      |
| `1280/r2/timing.json`                            | navigation timings (single sample)                     |
| `MANIFEST.md` / `MANIFEST.json`                  | method, artefact digests, redaction audit              |

## Change log

- 0.1.0 (2026-11-17) — initial draft from the signed-out capture at 390/768/1280.
