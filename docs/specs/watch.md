# Watch

Surface: web (signed-out, responsive at 390 / 768 / 1280)
Captured: 2026-11-17
Evidence: `docs/re-evidence/watch/`
Spec version: 0.1.0
Status: draft — awaiting G2 review
Machine contract: [`watch.json`](watch.json)

## Purpose

The watch page is where a chosen video is actually consumed and where the product's trust is won
or lost: the player, the identity of what is playing, the actions around it, the description and
the next thing to watch. This spec covers the **layout and control surface** of that page. The
description body, the comment section and the queue are separate flows (B), deliberately not
specified here.

## Method and confidence

- Chrome 157, one fresh signed-out profile per run, viewports 390×844, 768×1024 and 1280×800,
  ratio 1. One public documentary video was used at all three widths, discovered through public
  search results rather than hardcoded.
- A pre-roll ad was skipped and a signed-out promo overlay dismissed before capture, because both
  cover the player and metadata. The dismissal is recorded in `1280/r6/summary.json`.
- Per state: DOM snapshot, accessibility tree, screenshot, and in-page navigation/paint/LCP
  entries. Theater latency is wall-clock from click to a player-width change.
- Navigation timings are single samples per viewport. Layout-shift numbers are **not** reported:
  dismissing an overlay changes layout, so the measured value is not comparable to a clean load.

## Entry points

- Any video card, search result, channel upload or related-video item.
- Direct navigation to the watch route with a video id.
- Not observed: entry from a signed-in subscription feed, a playlist, or the short-form surface.

## States

| State        | Trigger                         | What the user sees                                                                                                                                                                                                                                | Recovery               |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| ready        | watch route resolved            | 16:9 player; title; owner row with avatar, channel, subscriber count and subscribe; action row (like with count, dislike, share, save, more); description panel with view/date/hashtag line and expander; comments below; related rail on desktop | —                      |
| loading      | route entry                     | **not captured** as a distinct state: the player shell streams first and metadata follows; no skeleton was observed                                                                                                                               | automatic              |
| unavailable  | video blocked by network policy | authored panel: unavailable heading, a sentence explaining the administrator restriction, and a comments-off line; no player                                                                                                                      | none offered           |
| error        | player/next endpoints fail      | metadata still renders; no alert or retry in the observed window                                                                                                                                                                                  | none observed          |
| offline cold | navigation while offline        | the browser's own network error page                                                                                                                                                                                                              | browser retry          |
| disabled     | signed-out session              | like, subscribe, save and comment entry points are present and lead to auth; pre-roll ads and site promos may cover content until dismissed                                                                                                       | sign in (out of scope) |

Evidence: `1280/r6/state-ready.*`, `768/r2/watch.json`, `390/r4/watch.json`,
`390/r3/state-ready.*` (the restricted case), `1280/r6/error.json`, `1280/r6/offline.json`
(2026-11-17).

Three behaviours matter for a re-implementation:

1. **The page is ad-adjacent.** A pre-roll appeared on most loads and had to be skipped before the
   content was visible; a signed-out promo overlay covered the metadata until dismissed.
2. **Restricted videos have an authored face.** The unavailable panel names the administrator
   restriction rather than showing a broken player or a generic error.
3. **A failed player request is silent at page level.** Metadata remains and no page alert
   appears; the player owns its own error surface.

## Controls

| Control              | Keyboard   | Pointer    | ARIA / name                                     | Behaviour                                                |
| -------------------- | ---------- | ---------- | ----------------------------------------------- | -------------------------------------------------------- |
| play / pause         | k, Space   | click      | "Play keyboard shortcut k"                      | toggles playback                                         |
| mute                 | m          | click      | "Mute keyboard shortcut m"                      | toggles audio                                            |
| volume               | Arrow keys | drag       | slider "Volume"                                 | —                                                        |
| seek                 | Arrow keys | drag/click | slider "Seek slider"                            | —                                                        |
| time readout         | —          | —          | "<current> of <duration>"                       | shows position and length                                |
| autoplay             | Enter      | click      | "Autoplay is on"                                | toggle; not exercised                                    |
| subtitles            | c          | click      | "Subtitles/closed captions keyboard shortcut c" | toggles captions                                         |
| settings             | Enter      | click      | "Settings"                                      | opens the player menu; not exercised                     |
| theater              | t          | click      | "Theater mode keyboard shortcut t"              | widens the player from 873 to 1265 px and hides the rail |
| full screen          | f          | click      | "Full screen keyboard shortcut f"               | —                                                        |
| channel link         | Enter      | click      | link                                            | opens the channel route                                  |
| subscribe            | Enter      | click      | "Subscribe to <channel>."                       | auth surface; out of scope                               |
| like                 | Enter      | click      | "like this video along with <n> other people"   | auth surface; out of scope                               |
| dislike              | Enter      | click      | "Dislike this video"                            | —                                                        |
| share                | Enter      | click      | "Share"                                         | —                                                        |
| save                 | Enter      | click      | "Save to playlist"                              | —                                                        |
| more actions         | Enter      | click      | "More actions"                                  | —                                                        |
| description expander | Tab, Enter | click      | "…more"                                         | expands the collapsed panel                              |
| comments             | scroll     | click      | region                                          | count, sort, add-comment entry point and threads         |
| related video        | Tab, Enter | click      | link                                            | 20 items desktop, 9 narrow                               |

Evidence: `1280/r6/keyboard.json`, `1280/r6/watch.json`, `1280/r6/theater.json`,
`1280/r6/comments.json` (2026-11-17).

## Events and timings

| Event                    | From → To             | Measured range | n   | Evidence                   |
| ------------------------ | --------------------- | -------------- | --- | -------------------------- |
| theater toggle           | click → player widens | 257–530 ms     | 3   | theater.json               |
| server response start    | navigation            | 120–840 ms     | 3   | timing.json (three widths) |
| first contentful paint   | navigation            | 840–1660 ms    | 3   | timing.json                |
| DOMContentLoaded         | navigation            | 2005–3285 ms   | 3   | timing.json                |
| load event end           | navigation            | 3596–4828 ms   | 3   | timing.json                |
| largest contentful paint | navigation            | 2920–8836 ms   | 3   | timing.json                |

The 390 sample had the latest LCP (8836 ms), consistent with the poster image arriving late on a
narrow layout. Layout shift is intentionally absent, see above.

## Accessibility

- Focus order at 1280: overlay close → player overlay control → seek slider → play → mute → volume
  slider → time readout → autoplay → subtitles → settings → theater → full screen → channel link →
  subscribe → like → dislike.
- Player controls carry explicit names that include their keyboard shortcut, which is unusually
  good and worth preserving.
- The video title is a level-one heading.
- Measured roles: 146 buttons, 70 links, 62 tooltips, 43 groups; 2945 accessibility nodes, 821
  ignored.
- Reduced motion: no running CSS animations were reported, before or under
  `prefers-reduced-motion: reduce` (0 and 0).

Evidence: `1280/r6/keyboard.json`, `390/r4/keyboard.json`, `1280/r6/state-ready.ax.json`,
`1280/r6/reduced-motion.json` (2026-11-17).

## Appearance

| Element        | 1280                                   | 768                     | 390                    |
| -------------- | -------------------------------------- | ----------------------- | ---------------------- |
| player         | 873×491 at (16, 68), 16:9              | 753×432 at (0, 56)      | 375×240 at (0, 56)     |
| title          | 20/28, weight 600                      | not separately measured | 18/26, weight 700      |
| channel        | 16 px, weight 500                      | —                       | 14 px, weight 500      |
| primary column | 873                                    | —                       | 427 (overflows 375)    |
| related rail   | 344 wide at x=905, 16 px gap           | below content, 9 items  | below content, 9 items |
| description    | 873×104 collapsed, radius 12           | 721×104                 | 427×104                |
| action buttons | 40 px tall; subscribe 95×40, radius 20 | —                       | —                      |
| page           | `rgb(15, 15, 15)`, Roboto/Arial        | same                    | same                   |

Evidence: `1280/styles/watch-styles.json`, `390/styles/watch-styles.json`,
`1280/r6/watch.json` (2026-11-17).

## Gaps and unknowns

1. **Loading state is unobserved.** The page streams; no skeleton was seen before the title.
2. **Error state is unobserved at page level.** Blocking player/next left metadata rendered and no
   alert; the player's internal error surface was not isolated.
3. **Layout shift is unreliable.** Clearing a promo and skipping an ad changes layout, so CLS was
   not reported rather than reported wrong.
4. **Signed-out actions were not followed** (like, subscribe, save, comment).
5. **Ads were not characterised.** A pre-roll appeared and was skipped; variants were not measured.
6. **Player menus were not opened** (settings, captions, quality).
7. **Seek and chapters were not exercised.**
8. **Autoplay was not toggled.**
9. **The 390 metadata column measures 427 px inside a 375 px viewport**; the cause is not
   established.
10. **Comments on narrow viewports have no threads in the initial DOM**; loading behaviour unknown.
11. **Queue, mini-player and up-next autoplay are separate flows** and are not covered.
12. **One region, a small set of videos, one ad environment.** Composition varies by assignment.

## Deviations in Viewly

None recorded yet. Viewly's watch page already has a comparable structure (official embed, title,
channel card, actions, expandable description, comments tab, Up next rail), so the parity report
for this flow is expected to be the closest of the three so far. No Viewly code was changed and no
contract tests are written before the G2 freeze.

## Evidence index

| Artefact                                       | Supports                                     |
| ---------------------------------------------- | -------------------------------------------- |
| `1280/r6/`, `768/r2/`, `390/r4/`               | ready layout, controls, focus order, timings |
| `1280/styles/`, `390/styles/`                  | title/column/player appearance               |
| `1280/r6/shots/state-ready.png`                | full desktop layout                          |
| `1280/r6/shots/state-description-expanded.png` | description expansion                        |
| `1280/r6/shots/state-theater.png`              | theater mode                                 |
| `1280/r6/shots/state-comments.png`             | comment section                              |
| `390/r3/shots/state-ready.png`                 | restricted-video unavailable state           |
| `1280/r6/summary.json`                         | ad skipped, promo dismissed                  |
| `MANIFEST.md` / `MANIFEST.json`                | method, artefact digests, redaction audit    |

## Change log

- 0.1.0 (2026-11-17) — initial draft from the signed-out capture at 390/768/1280.
