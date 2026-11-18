# Watch: player chrome

Surface: web
Captured: 2026-11-18
Evidence: `src/components/video/watch-shortcuts*`, theater/listen preference suites
Spec version: 0.1.0
Status: draft

## Purpose

The player is surrounded by a chrome of controls that never navigate away from
playback: keyboard shortcuts, the shortcuts overlay, theater mode, listen mode
and the mini-player. Each is an independent switch with its own persisted
preference, and every one degrades to a no-op when the player is not ready.

## Entry points

- Keyboard focus on the page (not inside an editable field).
- **Keyboard shortcuts** button opens the overlay.
- **Theater** toggle, **Listen mode** switch, **Mini-player** toggle.

## States

| State     | Trigger                 | What the user sees                        | Recovery     |
| --------- | ----------------------- | ----------------------------------------- | ------------ |
| ready     | player loaded           | full chrome and shortcuts active          | —            |
| loading   | player not ready        | controls render, shortcuts no-op          | wait         |
| help-open | shortcuts button or `?` | overlay with the key table; Escape closes | Escape/close |
| theater   | toggle on               | player widens, rail hidden                | toggle off   |
| listen    | switch on               | video hidden, audio-first layout          | switch off   |
| mini      | toggle on               | compact player in the corner              | toggle off   |

## Controls

| Control           | Keyboard                   | Pointer | ARIA            | Notes                    |
| ----------------- | -------------------------- | ------- | --------------- | ------------------------ |
| Play/pause        | Space, K                   | button  | pressed state   | repeats ignored          |
| Seek              | J/L (10s), Left/Right (5s) | button  | —               | ignores editable targets |
| Volume            | Up/Down (5 points)         | button  | —               | mute via M               |
| Fullscreen        | F                          | button  | —               | —                        |
| Theater           | T                          | button  | `aria-pressed`  | persisted                |
| Shortcuts overlay | ? opens, Escape closes     | button  | dialog          | focus trapped while open |
| Listen mode       | —                          | switch  | `role="switch"` | persisted                |

## Events and timings

| Event          | From   | To     | Budget             |
| -------------- | ------ | ------ | ------------------ |
| Seek step      | key    | player | same frame         |
| Toggle theater | toggle | layout | instant (CSS grid) |
| Overlay open   | button | dialog | instant            |

## Accessibility

- Focus order: player, then chrome controls, then the shortcuts overlay trigger.
- Focus return: closing the overlay returns focus to its trigger.
- Reduced motion: theater and mini transitions are not animated.
- Screen-reader names: toggle names announce state; the overlay is a labelled dialog.

## Deliberate deviations

- YouTube's full shortcut set, chapters-in-player and ambient mode are not
  reproduced; the shipped set is the table above.
- Listen mode is Viewly's own affordance, not a YouTube feature.
- Preferences are device-local (storage), never written to the account.
