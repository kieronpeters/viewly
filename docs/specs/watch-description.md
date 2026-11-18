# Watch: description

Surface: web
Captured: 2026-11-18
Evidence: `docs/re-evidence/watch/`
Spec version: 0.1.0
Status: draft

## Purpose

The description panel under the player carries the publisher's text, outbound
links and chapter timestamps. It is collapsed to a fixed height on a long
description, expands in place without navigation, and never executes markup.

## Entry points

- `/watch/<id>` renders the panel below the player and above the discussion.
- Expanding the panel with **Show more**; collapsing with **Show less**.

## States

| State     | Trigger                  | What the user sees           | Recovery |
| --------- | ------------------------ | ---------------------------- | -------- |
| collapsed | long description on load | clipped text + **Show more** | expand   |
| expanded  | **Show more** pressed    | full text + **Show less**    | collapse |
| short     | description fits         | full text, no toggle         | —        |
| empty     | publisher wrote nothing  | no panel text, no toggle     | —        |
| error     | upstream video missing   | route-level error state      | retry    |

## Controls

| Control      | Keyboard    | Pointer | ARIA                                     | Notes                             |
| ------------ | ----------- | ------- | ---------------------------------------- | --------------------------------- |
| Show more    | Enter/Space | click   | `aria-expanded="false"`, `aria-controls` | text button                       |
| Show less    | Enter/Space | click   | `aria-expanded="true"`, `aria-controls`  | same control                      |
| Timestamp    | Enter/Space | click   | `aria-label="Seek to 12:34"`             | seeks the player, never navigates |
| Outbound URL | Enter       | click   | link, `target="_blank"`, `rel` noopener  | only http(s)                      |

## Events and timings

| Event          | From        | To        | Budget                |
| -------------- | ----------- | --------- | --------------------- |
| Expand         | collapsed   | expanded  | instant (local state) |
| Collapse       | expanded    | collapsed | instant               |
| Seek via stamp | description | player    | same frame            |

## Accessibility

- Focus order: panel text is static; the toggle and any outbound links are the only stops.
- Focus return: the toggle stays focused across expand/collapse; no focus trap.
- Reduced motion: no animated height; state swaps instantly.
- Screen-reader names: **Show more** / **Show less**; timestamps announce "Seek to …".

## Deliberate deviations

- Viewly clips the panel with `max-h-40` rather than the observed measured line count;
  the visual result is the same at 390/768/1280.
- The panel does not render raw HTML from the publisher; text plus safe http(s) links only.
