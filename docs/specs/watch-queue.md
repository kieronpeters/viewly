# Watch: queue

Surface: web
Captured: 2026-11-18
Evidence: component and store suites (`src/components/video/watch-queue*`)
Spec version: 0.1.0
Status: draft

## Purpose

The queue is a local, ordered list of videos to watch after the current one.
It sits below "Up next", survives reloads, and owns the post-video hand-off when
it is not empty: autoplay of the first item, a sleep timer, and reordering.

## Entry points

- **Add to queue** on an Up-next row or a video card menu.
- The queue section in the watch workspace rail.
- Survives reload through local storage.

## States

| State   | Trigger                     | What the user sees                                                     | Recovery     |
| ------- | --------------------------- | ---------------------------------------------------------------------- | ------------ |
| empty   | nothing queued              | **Queue** heading, "Your queue is empty", destructive actions disabled | add a video  |
| ready   | one or more queued          | "Queued videos" list in order + controls                               | —            |
| playing | video ends, queue non-empty | first item starts; countdown/cancel offered                            | cancel/clear |
| sleep   | sleep timer running         | remaining time, cancel                                                 | cancel       |

## Controls

| Control       | Keyboard | Pointer | ARIA                        | Notes                   |
| ------------- | -------- | ------- | --------------------------- | ----------------------- |
| Add to queue  | Enter    | click   | button with the video name  | idempotent per video id |
| Remove        | Enter    | click   | button, row-scoped          | no-op for unknown id    |
| Move up/down  | Enter    | click   | button                      | index clamped           |
| Shuffle queue | Enter    | click   | button, disabled when empty | membership preserved    |
| Clear queue   | Enter    | click   | button, disabled when empty | destructive             |
| Sleep timer   | Enter    | click   | labelled control            | cancels on clear        |
| Autoplay next | —        | toggle  | switch                      | queue wins over Up next |

## Events and timings

| Event           | From        | To        | Budget                                      |
| --------------- | ----------- | --------- | ------------------------------------------- |
| Add             | any surface | queue     | instant (local storage)                     |
| Hand-off on end | video end   | next item | event-driven, no clock read on first render |
| Clear           | ready       | empty     | instant                                     |

## Accessibility

- Focus order: section heading, then per-row controls, then shuffle/clear.
- Focus return: after removing a row, focus stays in the queue region.
- Reduced motion: row movement is not animated.
- Screen-reader names: **Queue**, "Queued videos", the per-row action names.

## Deliberate deviations

- The queue is device-local; it is not YouTube's remote queue and is never
  written back to the account.
- Reordering is button-based rather than drag-and-drop, so it stays keyboard
  accessible without a pointer.
