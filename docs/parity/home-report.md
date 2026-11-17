# Home parity report — spec 0.1.0

Status: **baseline, pre-implementation**
Spec under test: [`docs/specs/home.md`](../specs/home.md) / [`home.json`](../specs/home.json), specVersion 0.1.0, captured 2026-11-17
Code under test: `main` @ `06d93f3` (spec and contract tests uncommitted at the time of the run)
Surface: signed-out web at 390 / 768 / 1280 (spec evidence: `docs/re-evidence/home/`)

## Contract results

`tests/contracts/home.contract.test.tsx` — 15 contracts: **14 satisfied, 1 gap**.

| Contract                                                 | Spec reference           | Status  | Note                                               |
| -------------------------------------------------------- | ------------------------ | ------- | -------------------------------------------------- |
| skip link is the first focus stop, targets `main`        | `a11y.skipLinkPresent`   | pass    | Viewly is stronger here: first stop, not third     |
| one main landmark, labelled primary navigation           | `a11y` roles             | pass    | —                                                  |
| named search landmark with a labelled field              | `controls.search-field`  | pass    | —                                                  |
| `/` moves focus into search                              | `controls.search-field`  | pass    | implemented as a masthead shortcut                 |
| chips are a tablist with one selected chip               | `controls.filter-chips`  | **gap** | chips are links to `/category/<slug>`, not filters |
| card is one link to `/watch/<id>` named by its title     | `controls.card-link`     | pass    | —                                                  |
| title clamps to two lines, duration is announced         | `appearance.card`        | pass    | `line-clamp-2`, screen-reader "Duration" prefix    |
| channel and view count shown                             | `states.ready`           | pass    | —                                                  |
| motion switches off under reduced motion                 | `a11y.reducedMotion`     | pass    | `motion-reduce` classes plus a global rule         |
| publish age shown next to views                          | states.ready             | pass    | rendered as a relative age (ormatRelativeAge)      |
| overflow menu opens, Escape closes, focus returns        | `controls.card-overflow` | pass    | overflow menu with focus return                    |
| list of cards is named by its heading                    | `appearance.shelf`       | pass    | —                                                  |
| loading row is announced and placeholders are decorative | `states.loading`         | pass    | `role="status"`, `aria-hidden` skeletons           |
| authored empty state with a recovery path                | `states.empty`           | pass    | component supports heading, message, action        |
| failure is announced and offers retry                    | `states.error`           | pass    | deliberate deviation, see below                    |

The two markers in the suite are intentional: `it(...)` fails on regression, while
`it.fails(...)` documents a gap and starts failing when the behaviour is implemented, which
forces it to be promoted and this report to be updated.

## Gaps and their reason

1. **`/` search shortcut** — no global key handler exists. Cheap to add; needs a decision on
   scoping it away from inputs and the command palette (`Ctrl/Cmd+K` already owns a global
   shortcut).
2. **Filter chips as a tablist** — Viewly's chips navigate to a category route; the spec
   describes in-place filtering. In-place filtering costs one discovery call per selection, so
   this is a product decision rather than a bug. If it stays a link model, record it as a
   deviation with that reason instead of implementing it.
3. **Publish age** — `VideoSummary.publishedAt` is normalised and already used by
   `format-published-date.ts`; the card simply does not render it. Pure implementation gap.
4. **Card overflow menu** — the spec expects a small menu of account-adjacent actions
   (~30–40ms open, Escape returns focus). No menu component exists on cards today.

## Deliberate deviations

| Area        | Spec (observed surface)                           | Viewly                                           | Reason                                                                                         |
| ----------- | ------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| error state | skeleton persists, then the empty panel; no retry | `ErrorState` announces an alert and offers retry | A silent failure is unacceptable in a local app; recovery is cheap and the user is not misled. |
| skip link   | third focus stop                                  | first focus stop                                 | Earlier escape from the shell is strictly better and costs nothing.                            |
| home shape  | masthead + filter chips + responsive card grid    | hero + category links + horizontal shelves       | Largest structural gap; needs a home redesign, tracked below.                                  |

## Structural gap (not contract-testable yet)

The contract suite composes the components the home page uses; it does not render the async
server page, and jsdom has no layout engine. Two spec-level differences are therefore recorded
here rather than asserted in code:

- **Shell**: the spec's masthead carries search, chips and account; Viewly's shell is a sidebar
  plus a mobile bottom bar, with search inside the page.
- **Grid**: the spec's feed is a 3/2/1-column card grid starting at `y=136`; Viewly's home is a
  hero, a category-chip row and horizontal shelf rows. Column counts, spacing and colour are not
  observable in jsdom and are reviewed manually instead.

Closing this gap is a redesign, not a patch; it needs an owner decision before implementation.

## Performance

Handover budgets: route transition < 300 ms, player ready < 1.5 s, INP < 200 ms, no layout shift.

**Not measured in this baseline.** The contract run says nothing about runtime performance, and
a dev-server measurement would be dominated by compilation. The planned measurement is a
production build (`npm run build && npm start`) loaded with the same capture harness
(`REA_START_URL=http://localhost:3000/`, `--steps baseline`), which records FCP, LCP, CLS and
long tasks to `docs/re-evidence/home/` for a direct comparison with the spec's ranges. Until
that runs, no parity claim is made.

For context only, the observed surface (external network, one machine) produced FCP 1.8–2.7 s,
LCP 2.4–5.4 s, CLS 0.0003–0.0128; those are context, not Viewly's budget.

## Accessibility checks

- Skip link, single `main`, labelled navigation: pass.
- One tab stop per card, link named by the title, decorative thumbnail: pass.
- Loading announced, skeletons hidden from assistive technology: pass.
- Empty and error states authored, error announced, retry reachable: pass.
- Reduced motion: card transitions and hover translation removed; skeleton pulse removed.
- Not covered: page-level heading order on the rendered home route, chip roving focus (gap 2),
  menu focus return (gap 4).

## Limitations

- jsdom cannot assert layout, colour, spacing or column counts.
- The async server home page is not rendered by the suite; its components are contract-tested.
- Four `it.fails` markers are the gap register; they are not failures of the suite.

## Environment notes

- Node 26 registers a global `localStorage` accessor that returns `undefined` unless the process
  runs with `--localstorage-file`; it shadows jsdom's Storage and broke 93 pre-existing
  persistence assertions. `tests/setup.ts` now supplies a jsdom-shaped in-memory Storage (proxy
  semantics included) only when the environment does not provide one, so it is inert on the
  Node 22/24 versions the project supports. This is an environment repair, not a behaviour
  change, and it is independent of the home spec.
- `docs/re-evidence/` was added to `.prettierignore`: the directory holds generated capture
  artefacts, is git-ignored, and is never formatted by hand.

## Reviewer sign-off

- G2: accepted by owner instruction ("continue") on 2026-11-17, spec retained at 0.1.0 for
  contract work.
- G3: pending — the four gaps must be either implemented or recorded as deviations with reasons.
- G4/G5: pending implementation and review.

## Post-redesign delta (P1-P2, 2026-11-17)

- Shell: 56px masthead with the search field, 72px icon rail (hidden below md), bottom bar on narrow screens.
- Home: chip row plus a 1/2/3-column grid (16px/36px gutters) inside its own Suspense boundary; hero removed.
- Card: 16:9 thumbnail (12px radius), two-line 16/22 title, 36px initial avatar, channel + views + relative age, overflow menu with Escape focus return.
- Search gains a clear-query control and the / shortcut; three home gaps and two search gaps are now enforced contracts.
