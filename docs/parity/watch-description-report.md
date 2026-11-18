# Watch description — parity report

Spec: `docs/specs/watch-description.md` (0.1.0, draft)
Contracts: `tests/contracts/watch-description.contract.test.tsx`

## Result

| Contract                                   | Status   |
| ------------------------------------------ | -------- |
| Text is rendered in the description panel  | enforced |
| No toggle for text that fits               | enforced |
| Show more/less with aria-expanded/controls | enforced |
| http(s) URLs become safe new-tab links     | enforced |
| Unsafe schemes stay text, never links      | enforced |

**5 enforced, 0 gaps.**

## Deviations

- The collapsed height is `max-h-40` rather than the observed measured line
  count. Same visual result at the captured widths; not worth a JS measurer.
- Raw HTML from the publisher is never rendered. Text plus safe links only.

## Not covered here

- Timestamp buttons ("Seek to 12:34") are implemented and covered by the watch
  route tests; they belong to the player-chrome flow contract, not this panel.
- Chapter headings are generated from the description and covered by the
  chapters contract.

## Limitations

- Evidence for this panel comes from the watch captures (`docs/re-evidence/watch/`);
  no separate signed-out capture run was made for the panel alone.
