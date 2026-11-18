# Watch comments — parity report

Spec: `docs/specs/watch-comments.md` (0.1.0, draft)
Contracts: `tests/contracts/watch-comments.contract.test.tsx`

## Result

| Contract                                                  | Status   |
| --------------------------------------------------------- | -------- |
| Tablist with exactly Comments and Your notes              | enforced |
| Comments selected on load, both panels mounted            | enforced |
| aria-controls/aria-labelledby pair the tab and panel      | enforced |
| Arrow keys plus Home/End move selection and focus         | enforced |
| Switching tabs only hides a panel; state is not remounted | enforced |

**5 enforced, 0 gaps.**

## Deviations (accepted)

- No reply tree, comment sorting or voting. Viewly lists the public top-level
  comments read-only and offers **Comment on YouTube** for everything else.
- **Your notes** is Viewly-only local data; it is never posted to YouTube.
- The comments panel fetches a single page; there is no infinite scroll.

## Boundaries

- Comment text is never copied into specs, fixtures or reports.
- A failed comments read is contained in the panel; the player, description and
  notes stay usable.
