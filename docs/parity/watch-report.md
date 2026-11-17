# Watch parity report — spec 0.1.0

Status: **baseline, pre-implementation**
Spec under test: [`docs/specs/watch.md`](../specs/watch.md) / [`watch.json`](../specs/watch.json), specVersion 0.1.0, captured 2026-11-17
Code under test: `main` @ `9b9df34` (spec and contract tests uncommitted at run time)
Surface: signed-out web at 390 / 768 / 1280 (spec evidence: `docs/re-evidence/watch/`)

## Contract results

`tests/contracts/watch.contract.test.tsx` — **5 contracts, all satisfied, no gap markers**.

| Contract                                                    | Spec reference                  | Status | Note                                                    |
| ----------------------------------------------------------- | ------------------------------- | ------ | ------------------------------------------------------- |
| primary column plus a rail labelled "Suggested videos"      | `viewports`, `controls.related` | pass   | the rail is an `aside` with an explicit accessible name |
| stage layout reports its theater state for styling          | `controls.theater`              | pass   | `data-theater` drives the wide layout                   |
| description is a named region with views, duration and date | `controls.description`          | pass   | stats are omitted when null rather than printed blank   |
| long descriptions collapse behind an expander               | `controls.description`          | pass   | `...more` equivalent                                    |
| loud absence is authored: "no description was provided"     | `controls.description`          | pass   | —                                                       |
| loading rail is announced and placeholders are decorative   | `states.loading`                | pass   | `role="status"` + `aria-hidden` geometry                |

Watch is the closest surface to parity so far, because Viewly already ships the same shape: the
official embed in a 16:9 box, title, channel row, action row, expandable description, discussion
tabs and a sticky Up next rail with a queue.

## Route-level gaps (no `it.fails` markers)

These need a full server-component graph or a live failure class to exercise, so they are tracked
here rather than faked in the suite:

1. **Restricted/unavailable video.** The observed surface shows an authored panel explaining an
   administrator restriction. Viewly resolves an unavailable video to the segment 404. Distinguishing
   "restricted" from "deleted" needs a decision (and probably a policy-aware read), so it is not a
   test marker yet.
2. **Page-level error.** A failed player/next request leaves the observed metadata rendered with no
   page alert. Viewly's route error boundary and the player's own surface were not exercised against
   a blocked player.
3. **Ads.** The observed surface carries pre-roll ads and a signed-out promo overlay. Viewly is
   deliberately ad-free, which is a product decision, not a defect.

## Deliberate deviations

| Area            | Spec (observed surface)                       | Viewly                                              | Reason                                                                     |
| --------------- | --------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| ads             | pre-roll and promo overlays                   | none                                                | Viewly serves no ads; reproducing them adds no value.                      |
| account actions | like, subscribe, save-to-playlist with counts | favourites, watch later, local playlists, copy link | Viewly is local-first with no accounts; the same intent is served locally. |
| comments        | YouTube threads                               | a comments tab plus a separate local notes tab      | Notes are Viewly's own feature and must stay distinct from comments.       |
| player chrome   | YouTube's own controls with shortcut names    | the official embed, unmodified                      | Parity by construction: there is nothing to reimplement inside the iframe. |

## Performance

Handover budgets: route transition < 300 ms, player ready < 1.5 s, INP < 200 ms, no layout shift.

**Not measured for Viewly in this baseline.** The spec's navigation samples (FCP 0.8–1.7 s,
DCL 2.0–3.3 s, LCP 2.9–8.8 s) describe the observed surface. The player-ready budget is the next
measurement to take once the shell work lands.

## Accessibility checks

- Rail is a labelled complementary landmark; the loading state is announced once.
- Description is a named region; the expander is a real button.
- The player's internal controls are the official embed's and are not assertable from the host page.
- Not covered: theater toggle keyboard path (unit-tested elsewhere), queue focus order.

## Limitations

- Component-level contracts only; the async route composition and the player iframe are not rendered.
- No `it.fails` markers for this flow; the three route-level gaps above are recorded here.
- One video, one region, one ad environment were observed during capture.

## Reviewer sign-off

- G2: accepted by owner instruction ("continue") on 2026-11-17, spec retained at 0.1.0.
- G3: satisfied for the five enforced contracts; route-level gaps tracked.
- G4/G5: pending the parity implementation programme.

## Post-redesign delta (P5, 2026-11-17)

- The rail is now 21.5rem (344px) at every lg+ breakpoint, matching the measured column, and the title is a fixed 20/28 semibold line box at all widths.
