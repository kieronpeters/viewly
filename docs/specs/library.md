# Library: history, continue watching and playlists

Surface: web
Captured: 2026-11-18
Evidence: `src/app/library/*`, `src/features/progress/continue-watching*`
Spec version: 0.1.0
Status: draft

## Purpose

`/library` groups everything the viewer saved or watched on this device into
four URL-addressed tabs, with a cross-tab continue-watching shelf and local
playlists. The URL is the state: every tab is a link, works without JavaScript,
can be bookmarked and is announced with `aria-current="page"`.

## Entry points

- Rail **Library**, or `/library?tab=…`.
- Continue-watching shelf on home and at the top of every library tab.
- Playlist names link to `/library/playlists/<id>`.

## States

| State       | Trigger                  | What the user sees                        | Recovery |
| ----------- | ------------------------ | ----------------------------------------- | -------- |
| tab ready   | any tab                  | header, tabs with counts, the active list | —        |
| empty list  | nothing saved/watched    | authored empty state with a browse link   | browse   |
| continue    | in-progress videos exist | shelf above the tabs                      | —        |
| no continue | none in progress         | shelf renders nothing                     | —        |
| error       | local read fails         | route error state                         | retry    |

## Controls

| Control         | Keyboard  | Pointer | ARIA                                           | Notes                     |
| --------------- | --------- | ------- | ---------------------------------------------- | ------------------------- |
| Tab links       | Tab/Enter | click   | link + `aria-current="page"` on the active one | URL-addressed, no tablist |
| Load a playlist | Tab/Enter | click   | link to the playlist route                     | —                         |
| Create playlist | Enter     | click   | labelled form                                  | local only                |
| Clear history   | Enter     | click   | two-step confirm                               | owner-scoped              |

## Events and timings

| Event             | From    | To     | Budget                      |
| ----------------- | ------- | ------ | --------------------------- |
| Tab switch        | any tab | target | server navigation           |
| Continue-watching | profile | shelf  | local read, behind Suspense |

## Accessibility

- Focus order: tabs in scan order, then the active list.
- Focus return: navigation is a normal page load; no focus trap.
- Reduced motion: list cards do not animate on hover beyond a transform that is
  disabled under `prefers-reduced-motion`.
- Screen-reader names: each tab link carries its label and count.

## Deliberate deviations

- Tabs are links, not an ARIA tablist: the URL is the state and a tab widget
  would promise arrow-key handling the page does not need.
- The library is device-local and owner-scoped (`local` or the signed-in
  account id); it does not mirror YouTube's own library.
