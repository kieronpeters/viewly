# System: accessibility and performance

Surface: web
Captured: 2026-11-18
Evidence: shell/accessibility suites, `docs/re-evidence/*/timings.json`
Spec version: 0.1.0
Status: draft

## Purpose

Cross-cutting guarantees for every route: one landmark structure with a skip
link, focus that is always visible, motion that respects the OS preference, and
a performance budget measured the same way on every capture.

## Entry points

- Every page renders inside the app shell.
- The skip link is the first focusable element on load.

## States

| State          | Trigger              | What the user sees                   | Recovery  |
| -------------- | -------------------- | ------------------------------------ | --------- |
| normal         | any page             | shell, landmarks, focus rings        | —         |
| keyboard-only  | Tab from the URL bar | skip link, then masthead, rail, main | —         |
| reduced-motion | OS preference set    | transitions effectively disabled     | —         |
| slow network   | API latency          | skeletons inside Suspense            | automatic |

## Controls

| Control       | Keyboard  | Pointer | ARIA                    | Notes           |
| ------------- | --------- | ------- | ----------------------- | --------------- |
| Skip link     | Tab/Enter | click   | link to `#main-content` | first focusable |
| Main landmark | —         | —       | `main`, `tabIndex={-1}` | focus target    |
| Masthead      | —         | —       | `header` banner         | one per page    |
| Rail          | Tab       | click   | labelled navigation     | links only      |

## Performance budgets

Measured from a cold production build, 1280x800, local server:

| Metric                 | Budget  | Basis                                           |
| ---------------------- | ------- | ----------------------------------------------- |
| Route TTFB (local)     | ≤ 300ms | server log `application-code` for cached routes |
| First contentful paint | ≤ 1.5s  | capture `timings.json`                          |
| Largest contentful     | ≤ 2.5s  | capture `timings.json`                          |
| CLS                    | ≤ 0.1   | capture `layout-shift` entries                  |

These are Viewly budgets, not YouTube's; the observed YouTube ranges are
recorded in the flow specs (`home` 1.84–2.69s FCP, 2.42–5.38s LCP).

## Accessibility

- Focus order: skip link → masthead → rail → main content.
- Focus return: dialogs and menus return focus to their trigger.
- Reduced motion: a global `prefers-reduced-motion` rule collapses animations
  and transitions; per-component `motion-reduce:` classes back it up.
- Screen-reader names: one `main`, one banner; navigation regions are labelled.

## Deliberate deviations

- No automated axe run is committed; landmark, focus and name contracts cover
  the highest-risk regressions, and the flows assert their own semantics.
- Performance budgets are documented and measured manually from captures; there
  is no CI performance gate yet.
