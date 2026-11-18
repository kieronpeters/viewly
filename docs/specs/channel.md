# Channel

Surface: web (signed-out, responsive at 390 / 768 / 1280)
Captured: 2026-11-17
Evidence: `docs/re-evidence/channel/`
Spec version: 0.1.0
Status: draft — awaiting G2 review
Machine contract: [`channel.json`](channel.json)

## Purpose

A channel page answers three questions in one place: who publishes this content, what they have
published, and how to follow them. It is the destination behind every channel name in every
result, so its header carries the identity and its tabs split a large catalogue into usable
views. This spec covers the signed-out public channel surface: header, tabs, the home tab's
shelves, the videos tab's grid, and the states around them.

## Method and confidence

- Chrome 157, one fresh signed-out profile per run, viewports 390×844, 768×1024 and 1280×800,
  ratio 1. One public channel was observed. No login, no private endpoint, no media capture.
- The channel URL used for capture is recorded in the local evidence manifest only; this spec
  deliberately names no channel, handle or identifier.
- Per state: DOM snapshot, accessibility tree, screenshot, and in-page navigation/paint/LCP/CLS
  entries. Interaction latency is wall-clock from input dispatch to the observed change.
- Navigation timings are a single sample; tab-switch and skeleton timings are ranges over three
  and two samples respectively.

## Entry points

- Any channel name, avatar or card in search results, the home feed or a watch page.
- Direct navigation to a channel handle or channel id route.
- The tab routes (`videos`, `shorts`, `streams`, `playlists`, `posts`).
- Not observed: entry from a signed-in subscription feed, or the in-channel search tab.

## States

| State          | Trigger                       | What the user sees                                                                                                                                                                                                                                | Recovery               |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| ready (home)   | channel route resolved        | banner, avatar, name with a verification mark, handle, subscriber and video counts, one-line description with an expander, links expander, subscribe, six content tabs plus an in-channel search tab, a featured/trailer block and titled shelves | —                      |
| ready (videos) | videos tab activated          | same header; three sort chips (latest, popular, oldest) with one selected; card grid at 3/2/1 columns                                                                                                                                             | —                      |
| loading        | tab switch                    | header and tab bar stay; the content area becomes skeleton cards (62 skeleton elements, no cards)                                                                                                                                                 | automatic              |
| error          | content request fails         | the header renders and the content area is empty; no alert, no retry                                                                                                                                                                              | none offered           |
| offline cold   | navigation while offline      | the browser's own network error page; the app is not reached                                                                                                                                                                                      | browser retry          |
| empty          | channel or tab with no videos | **not observed**: the captured channel has thousands of videos and no empty tab was reachable                                                                                                                                                     | unknown                |
| disabled       | signed-out session            | subscribe and account actions are present but lead to auth; the links expander produced a signed-out notice modal instead of a links list                                                                                                         | sign in (out of scope) |

Evidence: `1280/r1/state-ready.*`, `1280/r1/state-videos.*`, `768/r1/state-videos.*`,
`390/r1/state-videos.*`, `1280/r1/videos.json`, `1280/r1/error.json`, `1280/r1/offline.json`,
`1280/r1/about.json` (2026-11-17).

Two behaviours matter for a re-implementation:

1. **A failed content request is silent.** The header stays, the content area goes empty and no
   error or retry appears. This is the same pattern as the home and search surfaces.
2. **Signed-out profile actions may be gated by a notice.** Activating the links expander showed a
   signed-out notice modal rather than the links list, so the control's signed-out behaviour differs
   from its signed-in behaviour.

## Controls

| Control              | Keyboard   | Pointer | ARIA / name                          | Behaviour                                                                             |
| -------------------- | ---------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| content tabs         | Tab, Enter | click   | role=tab, exactly one selected       | six labelled tabs plus an in-channel search tab; switching changes the route          |
| subscribe            | Enter      | click   | button "Subscribe"                   | leads to auth; out of scope                                                           |
| description expander | Tab, Enter | click   | "Description. <channel description>" | expands the one-line description                                                      |
| links expander       | Tab, Enter | click   | button                               | signed out, produced a signed-out notice modal                                        |
| sort chips           | Tab, Enter | click   | role=tab                             | latest / popular / oldest on the videos tab; application latency not measured         |
| video card           | Tab, Enter | click   | link                                 | thumbnail, duration, two-line title, metadata, overflow action; opens the watch route |
| shelf item           | Tab, Enter | click   | link                                 | horizontal shelf rows with their own titles on the home tab                           |
| in-channel search    | Tab, Enter | click   | tab                                  | scopes search to the channel; not exercised                                           |

Evidence: `1280/r1/keyboard.json`, `1280/r1/channel-header.json`, `1280/r1/videos.json`,
`1280/r1/shots/state-videos.png` (2026-11-17).

## Events and timings

| Event                    | From → To                  | Measured range | n   | Evidence                   |
| ------------------------ | -------------------------- | -------------- | --- | -------------------------- |
| tab switch               | click → route path changes | 519–731 ms     | 3   | videos.json (three widths) |
| skeleton visible         | click → skeleton cards     | 76–77 ms       | 2   | videos.json                |
| server response start    | navigation                 | 101 ms         | 1   | `1280/r1/timing.json`      |
| first contentful paint   | navigation                 | 516 ms         | 1   | `1280/r1/timing.json`      |
| DOMContentLoaded         | navigation                 | 2307 ms        | 1   | `1280/r1/timing.json`      |
| load event end           | navigation                 | 3970 ms        | 1   | `1280/r1/timing.json`      |
| largest contentful paint | navigation                 | 2900–4036 ms   | 1   | `1280/r1/timing.json`      |
| cumulative layout shift  | navigation                 | 0.0775         | 1   | `1280/r1/timing.json`      |

The 0.0775 layout shift in that sample is worth watching: the banner and description images load
late relative to the header box.

## Accessibility

- Focus order at 1280: guide toggle → brand link → skip navigation → query field → submit search →
  voice search → settings → sign-in → four guide destinations → description expander → first
  profile link. Channel-specific controls come after the shell.
- Tabs expose the `tab` role with a selected state; the tab bar is a tablist.
- The description expander has a computed name beginning with "Description." and the channel text.
- The skip link stays in the tab order; the shell keeps one main content target.
- Measured roles: 173 links, 89 buttons, 60 headings, 7 tabs; 3776 accessibility nodes, 1293
  ignored.
- Reduced motion: no running CSS animations were reported, before or under
  `prefers-reduced-motion: reduce` (0 and 0).

Evidence: `1280/r1/keyboard.json`, `390/r1/keyboard.json`, `1280/r1/state-ready.ax.json`,
`1280/r1/reduced-motion.json` (2026-11-17).

## Appearance

| Element       | 1280                                 | 768                    | 390                    |
| ------------- | ------------------------------------ | ---------------------- | ---------------------- |
| banner        | 1070×172                             | 642×103                | 359×58                 |
| avatar        | 160×160, circular                    | 120×120, circular      | not resolved           |
| name          | 36/50, weight 700                    | 36/50, weight 700      | 24/32, weight 600      |
| metadata      | 14/20, `rgb(170,170,170)`            | 12/18                  | 12/18                  |
| tab bar       | 1070×48                              | 642×48                 | 214×48                 |
| video columns | 3                                    | 2                      | 1                      |
| video card    | 347×273, thumb 347×195               | 311×253, thumb 311×175 | 202×192, thumb 202×114 |
| subscribe     | 95×40, radius 20, `rgb(241,241,241)` | full-width row         | full-width row         |
| page          | `rgb(15,15,15)`                      | same                   | same                   |

Shelf items on the home tab are 218×206 with 210×118 thumbnails. Column gaps are 16px.
Evidence: `1280/styles/channel-styles.json`, `768/styles/channel-styles.json`,
`390/styles/channel-styles.json`, `1280/r1/state-videos.dom.json` (2026-11-17).

## Gaps and unknowns

1. **Empty channel or empty tab is unobserved.** The captured channel has thousands of videos and
   every tab had content.
2. **Error state is unobserved.** A failed content request leaves the header and an empty content
   area with no alert or retry.
3. **Links list is unobserved signed out.** The expander produced a signed-out notice modal.
4. **Other tabs were not exercised** (short-form, live, playlists, posts).
5. **Sort chips were not activated.**
6. **In-channel search was not opened.**
7. **Subscribe and join flows were not followed** (auth surface).
8. **Pagination on the videos tab was not exercised.**
9. **The 390 avatar was not resolved** by the appearance probe.
10. **The 0.0775 layout shift was not isolated** to a cause.
11. **One channel, one region, one locale.** Composition varies by assignment.

## Deviations in Viewly

None recorded yet. No Viewly code was changed for this flow and no contract tests are written
before the G2 freeze. Channel parity will be very partial: Viewly has a channel route
(`/channel/[id]`), but its header, tabs and tab routes are its own design, so the deviations
report will be the honest place to measure the gap.

## Evidence index

| Artefact                                     | Supports                                  |
| -------------------------------------------- | ----------------------------------------- |
| `1280/r1/`, `768/r1/`, `390/r1/`             | home and videos tabs, focus order, states |
| `1280/styles/`, `768/styles/`, `390/styles/` | header and grid appearance                |
| `1280/r1/shots/state-videos.png`             | sort chips and grid                       |
| `1280/r1/shots/state-about-expanded.png`     | description expansion                     |
| `1280/r1/shots/state-links-panel.png`        | signed-out notice on the links expander   |
| `1280/r1/videos.json`                        | tab-switch and skeleton latency           |
| `1280/r1/timing.json`                        | navigation timings and layout shift       |
| `MANIFEST.md` / `MANIFEST.json`              | method, artefact digests, redaction audit |

## Change log

- 0.1.0 (2026-11-17) — initial draft from the signed-out capture at 390/768/1280.

## Deliberate deviations (2026-11-18)

- Only two channel sections exist (Videos, About). Shorts, live, playlists and
  posts have no data of their own in Viewly, so no empty tabs are fabricated.
- Uploads are listed newest first and cannot be re-sorted; there are no sort
  chips.
