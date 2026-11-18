# Watch: comments

Surface: web
Captured: 2026-11-18
Evidence: `docs/re-evidence/watch/`
Spec version: 0.1.0
Status: draft

## Purpose

Below the description, the watch page offers the public read-only comments for
the video and a private notes panel for the viewer. Both live in one ARIA tab
widget so switching never remounts either panel and never scrolls the page.

## Entry points

- `/watch/<id>` renders the region below the description.
- **Comments** is selected on load; **Your notes** is one tab away.

## States

| State            | Trigger                 | What the user sees                    | Recovery                |
| ---------------- | ----------------------- | ------------------------------------- | ----------------------- |
| comments loading | tab visible, fetch open | quiet status placeholder              | wait                    |
| comments ready   | page fetched            | comment list, newest first            | —                       |
| comments empty   | video has none          | "No comments yet" + outbound link     | —                       |
| comments error   | upstream failure        | inline alert, rest of page unaffected | retry by switching tabs |
| notes ready      | local notes exist       | note list, newest first               | —                       |
| notes empty      | no local notes          | authored empty state + composer       | add note                |

## Controls

| Control            | Keyboard            | Pointer | ARIA                                                              | Notes                       |
| ------------------ | ------------------- | ------- | ----------------------------------------------------------------- | --------------------------- |
| Tab: Comments      | Left/Right/Home/End | click   | `role="tab"`, `aria-selected`, roving `tabIndex`, `aria-controls` | panel toggled with `hidden` |
| Tab: Your notes    | Left/Right/Home/End | click   | same                                                              | —                           |
| Comment on YouTube | Enter               | click   | link, new tab                                                     | read-only escape hatch      |
| Add note           | Enter in form       | click   | labelled form controls                                            | local only                  |

## Events and timings

| Event          | From     | To          | Budget                   |
| -------------- | -------- | ----------- | ------------------------ |
| Switch tab     | Comments | Your notes  | instant (local state)    |
| Comments fetch | mount    | ready/error | network-bound; contained |

## Accessibility

- Focus order: tablist first, then the active panel's controls.
- Focus return: the selected tab receives focus on arrow-key changes.
- Reduced motion: no animated panel transitions.
- Screen-reader names: **Comments**, **Your notes**; panels are labelled by their tab.

## Deliberate deviations

- YouTube's comment tree, replies, sorting and voting are not reproduced.
  Viewly lists the public top-level comments read-only and links out for the rest.
- **Your notes** is Viewly-only (local, per device); it is not a YouTube feature.
- Notes and comments are never mixed: notes stay local and are never posted.
