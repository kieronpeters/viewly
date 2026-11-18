# Player chrome — parity report

Spec: `docs/specs/player-chrome.md` (0.1.0, draft)
Contracts: `tests/contracts/player-chrome.contract.test.ts`

## Result

| Contract                                       | Status   |
| ---------------------------------------------- | -------- |
| Space/K toggle play-pause                      | enforced |
| J/L and arrows seek ±10/±5 seconds             | enforced |
| Up/Down change volume; M mutes                 | enforced |
| F fullscreen, T theater, ? toggles the overlay | enforced |
| Editable targets are ignored                   | enforced |
| Modifier-key presses are ignored               | enforced |

**6 enforced, 0 gaps.**

## Covered elsewhere

- Theater persistence and the rail hiding: `watch-theater` suite.
- Listen-mode preference and layout: `listen-mode-preference` suite.
- Mini-player component and its toggle: `mini-player` suite.
- Shortcuts overlay dialog, focus trap and Escape: `watch-shortcuts-overlay` suite.

## Deviations (accepted)

- A subset of YouTube's shortcut set; no chapters-in-player or ambient mode.
- Listen mode is a Viewly affordance, not a YouTube feature.
- Theater/listen/mini preferences are device-local; nothing is written back.
