# Search parity report — spec 0.1.0

Status: **baseline, pre-implementation**
Spec under test: [`docs/specs/search.md`](../specs/search.md) / [`search.json`](../specs/search.json), specVersion 0.1.0, captured 2026-11-17
Code under test: `main` @ `f30d8d6` (spec and contract tests uncommitted at run time)
Surface: signed-out web at 390 / 768 / 1280 (spec evidence: `docs/re-evidence/search/`)

## Contract results

`tests/contracts/search.contract.test.tsx` — 12 contracts: **11 satisfied, 1 gap**.

| Contract                                                        | Spec reference           | Status  | Note                                                |
| --------------------------------------------------------------- | ------------------------ | ------- | --------------------------------------------------- |
| named search landmark with a labelled, prefilled query field    | `controls.query-field`   | pass    | GET form works before hydration                     |
| every filter control labelled; query carried with the selection | `controls.filters-panel` | pass    | inline selects, not a dialog                        |
| clear-filters appears only while a filter is active             | `controls.filters-panel` | pass    | URL is the single source of truth                   |
| clear-query control inside the field                            | `controls.clear-query`   | pass    | clear control in the field                          |
| named results region with one watch link per result             | `controls.result-row`    | pass    | —                                                   |
| loading announced, placeholder grid decorative                  | `states.loading`         | pass    | `role="status"`, `aria-hidden` grid                 |
| explicit load-more control when another page exists             | `controls.show-more`     | pass    | a link that navigates, not an in-place append       |
| authored empty state when the query matches nothing             | `states.empty`           | pass    | deliberate: the observed surface never showed one   |
| failure announced with retry instead of an empty list           | `states.error`           | pass    | deliberate: the observed surface never surfaced one |
| filter chips as a tablist                                       | `controls.filter-chips`  | **gap** | no chip row on the results surface                  |
| result title clamped to two lines                               | `appearance.resultRow`   | pass    | —                                                   |
| per-row action menu                                             | `controls.row-overflow`  | pass    | per-card overflow menu                              |

## Gaps and their reason

1. **Clear-query control** — the field has no adorner to empty it. Cheap to add and matches the
   observed surface, which shows a named clear button whenever a query is present.
2. **Filter chips** — Viewly filters through selects and the URL; the observed surface uses a
   row of chips (all / short-form / unwatched / videos / recently uploaded / live) that refilter
   in place. The chip model costs one discovery call per selection; the select model batches a
   deliberate apply. This is a product decision, not a defect.
3. **Per-row action menu** — cards have no overflow action. The observed surface exposes one on
   every row and on promoted tiles.

## Deliberate deviations

| Area             | Spec (observed surface)                                                                   | Viewly                                          | Reason                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| result layout    | mixed list of promoted tiles, channel cards, shelves, short-form rows and wide video rows | one uniform card grid                           | Uniform grid keeps parity of information and is simpler to scan; the mixed list exists to carry ads and channel promotion. |
| promoted content | sponsored tiles with call-to-action buttons                                               | none                                            | Viewly does not serve ads; reproducing them would add no value and conflicts with the product's premise.                   |
| filters          | modal panel with five groups, opened by a button                                          | inline labelled selects, applied via URL        | Inline controls are more direct on desktop, keyboard-friendly, and work before hydration.                                  |
| empty state      | unobserved; a spelling suggestion plus suggestions                                        | authored "no results for <query>" with guidance | An explicit empty state is better than an adjacent-content fallback.                                                       |
| error state      | unobserved; stale results, no alert                                                       | authored failure with retry                     | Silent staleness is unacceptable; retry is cheap.                                                                          |
| load more        | in-place append (~0.35–0.81 s)                                                            | link navigation with a page token               | Server-rendered pages keep the client simple; the trade-off is a route change.                                             |
| short-form shelf | present inside results                                                                    | absent                                          | Out of scope for the search flow; the short-form surface is a separate flow.                                               |

## Structural gap (not contract-testable yet)

The spec's result row is a wide row: a 500 px thumbnail with a text column at x=612, a two-line
title, view/age metadata, channel identity and a two-line description. Viewly renders the shared
`VideoCard` in a 1/2/3/4-column grid. jsdom cannot assert layout, so the difference is recorded
here rather than encoded as a failing test. Closing it is a results-surface redesign and needs an
owner decision together with the home-grid decision from the home flow.

## Performance

Handover budgets: route transition < 300 ms, player ready < 1.5 s, INP < 200 ms, no layout shift.

**Not measured for Viewly in this baseline.** The spec's navigation sample is a single slow load
(FCP 5.7 s, LCP 7.9–8.8 s, DCL 8.0 s, CLS 0, longest task 985 ms) and is context only. The planned
measurement is a production build loaded with the capture harness
(`REA_START_URL=http://localhost:3000/search?q=…`), recording FCP, LCP, CLS and long tasks for a
like-for-like comparison.

## Accessibility checks

- Query field and all three filter controls are labelled; the filter form is named and carries
  the query.
- Results are a named region with a real list; every result is one named link to the watch route.
- Loading is announced once and the placeholder grid is decorative.
- Empty and error states are authored; the error is announced as an alert with a retry control.
- Not covered: chip roving focus (gap 2), row menu focus return (gap 3), clear-query affordance
  (gap 1), and any appearance claim beyond the two-line title clamp.

## Limitations

- The results component is an async server component; the suite invokes it directly and renders
  the returned tree with a mocked YouTube client, so it asserts structure and states, not
  streaming.
- jsdom cannot assert layout, colour, spacing or row composition.
- Three `it.fails` markers are the gap register; they are not failures of the suite.
- One environment caveat from capture: this network enforces Restricted Mode, so the observed
  result composition is not representative of an unrestricted session.

## Reviewer sign-off

- G2: accepted by owner instruction ("continue") on 2026-11-17, spec retained at 0.1.0 for
  contract work.
- G3: pending — three gaps must be implemented or converted to documented deviations.
- G4/G5: pending implementation and review.

## Post-redesign delta (P1-P3, 2026-11-17)

- Search now renders inside the shared masthead, with a clear-query control and the / focus shortcut.
- Every result card carries the overflow menu, so the row-menu gap is closed.
- Results now render as wide rows (500px thumbnail, 18/26 two-line title, metadata, channel avatar); chip shortcuts sit above them as URL links.
- The row snippet description is omitted because Viewly does not normalize it from search.list; chip filters stay links, so the tablist gap remains open.

## Gap closed (2026-11-18)

Filter chips now render as a `role="tablist"` with `role="tab"` and
`aria-selected`, and the formerly expected-fail contract is enforced.
**12 enforced, 0 gaps** for this flow.
