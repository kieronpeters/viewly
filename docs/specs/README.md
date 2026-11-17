# Experience specs

One spec per YouTube flow. Specs describe **behaviour**, not branding: states, controls,
events, timings, accessibility and known gaps.

## Files

| File                   | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `<flow>.md`            | Human-readable spec, reviewed and frozen          |
| `<flow>.json`          | Machine-readable contract consumed by tests       |
| `<flow>.deviations.md` | Where Viewly intentionally differs, with a reason |

## Rules

1. Every claim cites an evidence artefact and a capture date.
2. No YouTube copy, imagery, identifiers or comment text.
3. States are exhaustive: loading, ready, empty, error, disabled, offline.
4. Timings are ranges, not single values.
5. A frozen spec changes only by a reviewed pull request.
6. Deviations are recorded, never hidden.

## Versioning

`specVersion` in the JSON increments on any behavioural change. Contract tests pin the
version they were written against.
