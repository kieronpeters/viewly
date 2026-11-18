# System — accessibility and performance report

Spec: `docs/specs/system.md` (0.1.0, draft)
Contracts: `tests/contracts/system.contract.test.tsx`

## Result

| Contract                                                | Status   |
| ------------------------------------------------------- | -------- |
| Exactly one main landmark, id `main-content`, focusable | enforced |
| Skip link is the first focusable element                | enforced |
| Global reduced-motion rule exists                       | enforced |

**3 enforced, 0 gaps.**

## Performance

Budgets in the spec (TTFB ≤300ms local, FCP ≤1.5s, LCP ≤2.5s, CLS ≤0.1) are
documented rather than asserted. They are measured from a cold production build
at 1280x800 using the capture harness (`scripts/rea/`), and the measured YouTube
ranges live in the flow specs.

## Not covered

- No automated axe/pa11y run is committed. Landmarks, focus order, accessible
  names and reduced motion are enforced; colour contrast and every ARIA
  relationship are not swept automatically.
- No CI performance gate; the budgets are a review checklist.

## Deviations (accepted)

- Performance is verified manually from captures rather than in CI.
