# Library — parity report

Spec: `docs/specs/library.md` (0.1.0, draft)
Contracts: `tests/contracts/library.contract.test.tsx`

## Result

| Contract                                              | Status   |
| ----------------------------------------------------- | -------- |
| Four sections with canonical hrefs                    | enforced |
| Exactly the active tab carries aria-current=page      | enforced |
| Unknown/duplicated tab values fall back to favourites | enforced |
| Empty continue-watching shelf renders nothing         | enforced |

**4 enforced, 0 gaps.**

## Deviations (accepted)

- Tabs are URL links rather than an ARIA tablist, deliberately: the URL is the
  state, pages work without JavaScript and the back button steps between tabs.
- The library is device-local and owner-scoped (`local` or the signed-in account
  id). It does not mirror YouTube's own library, and nothing is written back.
- Playlists are Viewly-only groupings of saved videos.

## Covered elsewhere

- Per-owner history, favourites and watch-later rows and clearing:
  `library.repository.test.ts` and the owner-scoping suites.
- Playlist detail, reordering and removal: the playlist suites.
- Continue-watching cards and progress bars: `continue-watching-section` suite.
