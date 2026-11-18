# Watch queue — parity report

Spec: `docs/specs/watch-queue.md` (0.1.0, draft)
Contracts: `tests/contracts/watch-queue.contract.test.ts`

## Result

| Contract                                  | Status   |
| ----------------------------------------- | -------- |
| Queued videos keep insertion order        | enforced |
| Adding the same video twice is a no-op    | enforced |
| Remove by id; unknown ids are ignored     | enforced |
| Clear empties the queue                   | enforced |
| Malformed stored JSON falls back to empty | enforced |

**5 enforced, 0 gaps.**

## Deviations (accepted)

- The queue is device-local; it is not YouTube's remote queue and is never
  written back to the account.
- Reordering is button-based, not drag-and-drop, so it stays keyboard accessible.
- Sleep-timer and autoplay behaviour are local to the player and covered by the
  player-chrome flow rather than duplicated here.

## Boundaries

- No clock is read during the first render; the hand-off timer starts on the
  playback-ended event.
- Storage is namespaced and versioned; junk is ignored rather than thrown.
