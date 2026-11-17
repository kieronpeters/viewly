# Channel parity report — spec 0.1.0

Status: **baseline, pre-implementation**
Spec under test: [`docs/specs/channel.md`](../specs/channel.md) / [`channel.json`](../specs/channel.json), specVersion 0.1.0, captured 2026-11-17
Code under test: `main` @ `de286ac` (spec and contract tests uncommitted at run time)
Surface: signed-out web at 390 / 768 / 1280 (spec evidence: `docs/re-evidence/channel/`)

## Contract results

`tests/contracts/channel.contract.test.tsx` — 11 contracts: **9 satisfied, 2 gaps**.

| Contract                                                     | Spec reference          | Status  | Note                                                     |
| ------------------------------------------------------------ | ----------------------- | ------- | -------------------------------------------------------- |
| level-one identity heading, subscriber count and description | `states.ready-home`     | pass    | —                                                        |
| off-site link to the channel's own page, new-tab warning     | attribution policy      | pass    | required by the YouTube policy, not by the observed UI   |
| decorative avatar, name announced once                       | `a11y`                  | pass    | `alt=""`, heading names the channel                      |
| subscriber line omitted when hidden, never rendered as zero  | `states.ready-home`     | pass    | —                                                        |
| uploads under a named heading with watch links               | `controls.video-card`   | pass    | named list, one link per card                            |
| identity card survives an uploads failure                    | `states.error`          | pass    | deliberate: the observed surface goes silent             |
| authored empty state for a channel without uploads           | `states.empty`          | pass    | deliberate: the observed empty state was never reachable |
| content tabs (six sections plus in-channel search)           | `controls.content-tabs` | **gap** | no tab model at all                                      |
| sort chips (latest / popular / oldest)                       | `controls.sort-chips`   | **gap** | no videos view to sort                                   |
| retry state for a failed channel lookup                      | `states.error`          | pass    | same-URL retry, not a 404                                |
| unknown channel is a 404                                     | `route`                 | pass    | `notFound()`                                             |

## Gaps and their reason

1. **Content tabs** — Viewly renders one page: identity card plus recent uploads. The observed
   surface splits the catalogue into home, videos, short-form, live, playlists and posts, plus an
   in-channel search tab. Reproducing the tab model is a channel-surface redesign.
2. **Sort chips** — there is no videos view, so there is nothing to sort. This follows from gap 1.

Both gaps are structural rather than missing controls, so they belong to the same decision as the
home-grid and results-row gaps.

## Deliberate deviations

| Area            | Spec (observed surface)                       | Viewly                                                          | Reason                                                                                                                          |
| --------------- | --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| layout          | banner, avatar, tabs, trailer, titled shelves | identity card plus a recent-uploads grid                        | A single, scannable page is simpler and needs no tab routing; shelves exist to surface editorial curation Viewly does not have. |
| subscribe       | subscribe button leading to auth              | absent                                                          | Viewly has no accounts by design; an auth funnel would be dead weight.                                                          |
| description     | one line with an expander                     | full description, line breaks preserved                         | No truncation to manage, nothing hidden from the reader.                                                                        |
| uploads failure | silent: header stays, content area empty      | authored "could not load recent uploads" with the header intact | Silent failure is unacceptable; the header is still useful without uploads.                                                     |
| empty channel   | unobserved                                    | authored "no uploads yet"                                       | Explicit empty state rather than an empty grid.                                                                                 |
| unknown channel | 404                                           | 404 via `notFound()`                                            | Same behaviour.                                                                                                                 |

## Structural gap (not contract-testable yet)

The observed header is a 172 px banner, a 160 px circular avatar, a 36/50 name, a tab bar and
seven shelves, inside a 1070 px content column. Viewly's header is a bordered card with a 96 px
avatar and a 2xl heading, followed directly by one grid. jsdom cannot assert layout, so the
difference is recorded here. Closing it is the channel-redesign decision.

## Performance

Handover budgets: route transition < 300 ms, player ready < 1.5 s, INP < 200 ms, no layout shift.

**Not measured for Viewly in this baseline.** The spec's navigation sample is a single load
(FCP 516 ms, DCL 2.3 s, load 4.0 s, LCP 2.9–4.0 s, CLS 0.0775) and is context only. The spec's own
tab-switch measurement (519–731 ms) and skeleton timing (76–77 ms) describe the observed surface,
not Viewly.

## Accessibility checks

- Single level-one heading for the channel, named uploads list, every card one named link.
- Decorative avatar kept out of the accessibility tree.
- Off-site link announces that it opens a new tab.
- Failure states are authored; the channel-lookup error offers a retry link.
- Not covered: tabs and sort chips (gaps 1–2), and any appearance claim beyond the heading level.

## Limitations

- The suite renders `ChannelDetailView` directly with fixtures and invokes the async
  `ChannelPageContent` for the route-level states; the streaming boundary itself is not asserted.
- jsdom cannot assert layout, colour, spacing or tab behaviour.
- Two `it.fails` markers are the gap register; they are not failures of the suite.
- One channel was captured; header composition and shelves vary by channel and assignment.

## Reviewer sign-off

- G2: accepted by owner instruction ("continue") on 2026-11-17, spec retained at 0.1.0 for
  contract work.
- G3: pending — the two structural gaps need a scope decision (implement, or convert to deviations
  alongside the home and results decisions).
- G4/G5: pending.
