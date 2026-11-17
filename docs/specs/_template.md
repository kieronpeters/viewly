# <Flow name>

Surface: <web | mweb | embed | shorts>
Captured: <YYYY-MM-DD>
Evidence: `docs/re-evidence/<flow>/`
Spec version: 0.1.0
Status: draft | frozen

## Purpose

What the flow is for, in one paragraph.

## Entry points

- <route or interaction that starts the flow>

## States

| State    | Trigger            | What the user sees      | Recovery     |
| -------- | ------------------ | ----------------------- | ------------ |
| loading  | route entry        | skeleton                | automatic    |
| ready    | data resolved      | content                 | —            |
| empty    | no results         | authored empty state    | change query |
| error    | upstream failure   | retry affordance        | retry        |
| disabled | capability missing | hidden or inert control | —            |

## Controls

| Control | Keyboard | Pointer | ARIA | Notes |
| ------- | -------- | ------- | ---- | ----- |
|         |          |         |      |       |

## Events and timings

| Event | From | To  | Budget |
| ----- | ---- | --- | ------ |
|       |      |     |        |

## Accessibility

- Focus order:
- Focus return:
- Reduced motion:
- Screen-reader names:

## Gaps and unknowns

- <what we could not observe, and why>

## Deviations in Viewly

See `<flow>.deviations.md`.
