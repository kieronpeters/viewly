# Midnight Purple theme

The Viewly design tokens live in `src/app/globals.css`. This document is the reference for the
palette: what each token is, how it is used, and the contrast each pairing is expected to hit.

Midnight Purple is a **dark-first, dark-only** identity: a near-black navy-violet canvas, quietly
lifted surfaces, one restrained violet accent, and calm, high-legibility text.

## Colour space

Tokens are authored in **OKLCH** because lightness there is perceptually even, which makes contrast
easy to reason about and adjust. Every token carries its sRGB hex equivalent as a comment so
reviewers can read the palette without an OKLCH converter. Tokens are exposed to Tailwind through
the `@theme inline` block, so `bg-surface`, `text-muted-foreground`, `border-border`, and the rest
work as normal utilities.

| New utility           | Token                      |
| --------------------- | -------------------------- |
| `bg-surface`          | `--color-surface`          |
| `bg-surface-elevated` | `--color-surface-elevated` |

## Dark is the only theme

Dark **is** the only supported theme. There is no light palette, no theme switcher, and no
`prefers-color-scheme` branch: the OS or browser preference must not change the app's appearance.
The palette is declared once for both `:root` and `.dark` (the class the root layout always sets),
and `color-scheme: dark` is applied unconditionally so native form controls, scrollbars, and
selection colours stay dark even when the OS is set to light.

> Rule: do not reintroduce a `@media (prefers-color-scheme: ...)` block that changes tokens, and do
> not add a light `:root` set. Any new token must also be dark-first.

## Palette

| Token                          | Value (OKLCH)            | Hex       | Intended use                                                 |
| ------------------------------ | ------------------------ | --------- | ------------------------------------------------------------ |
| `--background`                 | `oklch(0.16 0.028 285)`  | `#0C0B19` | App canvas and page background                               |
| `--foreground`                 | `oklch(0.96 0.008 285)`  | `#F1F1F7` | Default body text and icon colour                            |
| `--surface`                    | `oklch(0.196 0.03 285)`  | `#141322` | First lift above the canvas: section and list backgrounds    |
| `--surface-elevated`           | `oklch(0.232 0.033 287)` | `#1C1B2C` | Second lift: drawers, sheets, inline panels, hover cards     |
| `--card`                       | `oklch(0.208 0.031 286)` | `#171625` | Card and contained-block background                          |
| `--card-foreground`            | `oklch(0.96 0.008 285)`  | `#F1F1F7` | Text and icons on cards                                      |
| `--popover`                    | `oklch(0.224 0.033 287)` | `#1A192A` | Menus, popovers, command palette, tooltips                   |
| `--popover-foreground`         | `oklch(0.96 0.008 285)`  | `#F1F1F7` | Text and icons in popovers                                   |
| `--primary`                    | `oklch(0.66 0.15 295)`   | `#9A7DE3` | Primary action fill, and `text-primary` for links (5.94:1)   |
| `--primary-foreground`         | `oklch(0.18 0.03 285)`   | `#10101E` | Ink on primary fills (5.76:1), never white                   |
| `--secondary`                  | `oklch(0.276 0.038 288)` | `#27253A` | Secondary action fill, unselected chips                      |
| `--secondary-foreground`       | `oklch(0.95 0.01 285)`   | `#EDEEF5` | Text on secondary fills                                      |
| `--muted`                      | `oklch(0.258 0.032 288)` | `#232132` | Quiet fill: skeletons, inert rows, code blocks               |
| `--muted-foreground`           | `oklch(0.72 0.022 286)`  | `#A3A3B2` | Secondary text: captions, metadata, placeholders             |
| `--accent`                     | `oklch(0.318 0.058 293)` | `#342C4D` | Hover and selected wash for rows, menu items, tabs           |
| `--accent-foreground`          | `oklch(0.955 0.012 288)` | `#EFEFF8` | Text and icons on accent fills                               |
| `--border`                     | `oklch(0.49 0.028 288)`  | `#5F5E70` | Dividers, card outlines, control boundaries                  |
| `--input`                      | `oklch(0.5 0.03 289)`    | `#626174` | Input, select, and textarea boundaries                       |
| `--ring`                       | `oklch(0.675 0.14 295)`  | `#9E83E3` | Focus ring                                                   |
| `--destructive`                | `oklch(0.64 0.19 22)`    | `#E94F55` | Destructive fill, and `text-destructive` for errors (5.28:1) |
| `--destructive-foreground`     | `oklch(0.18 0.03 285)`   | `#10101E` | Ink on destructive fills (5.12:1), never white               |
| `--chart-1`                    | `oklch(0.72 0.15 295)`   | `#AC8FF8` | Chart series 1 (violet)                                      |
| `--chart-2`                    | `oklch(0.68 0.12 255)`   | `#639BE1` | Chart series 2 (blue)                                        |
| `--chart-3`                    | `oklch(0.76 0.11 195)`   | `#47C7C7` | Chart series 3 (teal)                                        |
| `--chart-4`                    | `oklch(0.8 0.11 85)`     | `#DEB866` | Chart series 4 (amber)                                       |
| `--chart-5`                    | `oklch(0.7 0.13 340)`    | `#D37DB8` | Chart series 5 (pink)                                        |
| `--sidebar`                    | `oklch(0.178 0.029 285)` | `#100F1D` | Sidebar background, one step below the canvas                |
| `--sidebar-foreground`         | `oklch(0.95 0.01 285)`   | `#EDEEF5` | Sidebar text and icons                                       |
| `--sidebar-primary`            | `oklch(0.66 0.15 295)`   | `#9A7DE3` | Active item fill in the sidebar                              |
| `--sidebar-primary-foreground` | `oklch(0.18 0.03 285)`   | `#10101E` | Ink on the active sidebar item                               |
| `--sidebar-accent`             | `oklch(0.258 0.035 289)` | `#232133` | Sidebar hover wash                                           |
| `--sidebar-accent-foreground`  | `oklch(0.95 0.01 285)`   | `#EDEEF5` | Sidebar text on hover wash                                   |
| `--sidebar-border`             | `oklch(0.495 0.028 288)` | `#616071` | Sidebar dividers and edges                                   |
| `--sidebar-ring`               | `oklch(0.675 0.14 295)`  | `#9E83E3` | Focus ring inside the sidebar                                |

`--radius` stays at `0.625rem`; the `--radius-*` scale in `@theme inline` derives from it.

## Contrast

Ratios are WCAG 2.2 contrast ratios computed from the sRGB hex equivalents above, using the
standard relative-luminance formula. Every value below is measured from the tokens as shipped.

### Required pairings

| Pair                               | Measured  | Requirement       | Result |
| ---------------------------------- | --------- | ----------------- | ------ |
| `foreground` on `background`       | 17.31 : 1 | 4.5:1 normal text | Pass   |
| `muted-foreground` on `background` | 7.81 : 1  | 4.5:1 normal text | Pass   |
| `primary-foreground` on `primary`  | 5.76 : 1  | 4.5:1 normal text | Pass   |
| `border` on `background`           | 3.09 : 1  | 3:1 UI boundary   | Pass   |

### Supporting pairings

| Pair                                      | Measured  | Requirement         | Result |
| ----------------------------------------- | --------- | ------------------- | ------ |
| `foreground` on `surface`                 | 16.29 : 1 | 4.5:1 normal text   | Pass   |
| `foreground` on `surface-elevated`        | 15.03 : 1 | 4.5:1 normal text   | Pass   |
| `foreground` on `card`                    | 15.90 : 1 | 4.5:1 normal text   | Pass   |
| `muted-foreground` on `card`              | 7.18 : 1  | 4.5:1 normal text   | Pass   |
| `popover-foreground` on `popover`         | 15.33 : 1 | 4.5:1 normal text   | Pass   |
| `secondary-foreground` on `secondary`     | 12.86 : 1 | 4.5:1 normal text   | Pass   |
| `accent-foreground` on `accent`           | 11.38 : 1 | 4.5:1 normal text   | Pass   |
| `destructive-foreground` on `destructive` | 5.12 : 1  | 4.5:1 normal text   | Pass   |
| `sidebar-foreground` on `sidebar`         | 16.34 : 1 | 4.5:1 normal text   | Pass   |
| `primary` on `background`                 | 5.94 : 1  | 4.5:1 link text     | Pass   |
| `primary` on `card`                       | 5.45 : 1  | 4.5:1 link text     | Pass   |
| `destructive` on `background`             | 5.28 : 1  | 4.5:1 error text    | Pass   |
| `input` on `background`                   | 3.22 : 1  | 3:1 UI boundary     | Pass   |
| `ring` on `background`                    | 6.32 : 1  | 3:1 focus indicator | Pass   |
| `sidebar-border` on `sidebar`             | 3.07 : 1  | 3:1 UI boundary     | Pass   |
| `chart-1` on `background`                 | 7.47 : 1  | 4.5:1 data mark     | Pass   |
| `chart-2` on `background`                 | 6.75 : 1  | 4.5:1 data mark     | Pass   |
| `chart-3` on `background`                 | 9.48 : 1  | 4.5:1 data mark     | Pass   |
| `chart-4` on `background`                 | 10.36 : 1 | 4.5:1 data mark     | Pass   |
| `chart-5` on `background`                 | 6.84 : 1  | 4.5:1 data mark     | Pass   |

### Known limits

- **Accent fills carry near-black ink, not white.** White on `primary` measures 3.14 : 1 and white
  on `destructive` 3.53 : 1, so white labels would fail AA at body size. The accents are therefore
  tuned light enough to work as text on the canvas (5.94 : 1 and 5.28 : 1) and carry `#10101E` ink
  instead (5.76 : 1 and 5.12 : 1). Do not swap `primary-foreground` or
  `destructive-foreground` back to a light colour.
- **Opacity hover modifiers soften labels.** Utilities such as `hover:bg-primary/80` composite the
  fill toward the canvas and drop ink contrast to roughly 4.0 : 1. Prefer full-opacity states or
  `accent` for hover; if a component must fade, keep it at `/90` or above.
- `background` and `surface` sit 1.06 : 1 apart. They are intentionally close: layering is carried
  by borders and elevation, not by big brightness jumps, so surface edges must always be drawn with
  a `border`-coloured line (3.09 : 1 on the canvas).
- `border` and `input` are opaque colours, not white-at-low-alpha. Against the canvas they measure
  3.09 : 1 and 3.22 : 1. Because the surface lifts are shallow, the same line measures 2.68–3.03 : 1
  on `surface`/`surface-elevated`. That is fine for dividers, which are decorative, but a control
  that sits on an elevated panel must not rely on its outline alone: give it an `input` fill, a
  label, or the 6.32 : 1 `ring` on focus.

## Using the palette

- Canvas: `bg-background text-foreground`.
- Grouping: `bg-surface` for a region, `bg-card` for discrete blocks, `bg-surface-elevated` or
  `bg-popover` for anything that floats above the page.
- Quiet text: `text-muted-foreground`. Never go below that for readable copy.
- Actions: `bg-primary text-primary-foreground` for the one main action per view;
  `bg-secondary text-secondary-foreground` for everything else.
- Links and error text: `text-primary` and `text-destructive` both clear 4.5:1 on the canvas and on
  cards, so the shadcn `link` and `destructive` button variants are readable as shipped.
- Focus: keep the `--ring` token; it is the only colour guaranteed to clear 3:1 for focus
  indication.

This is the base palette for later components: new UI should consume these tokens rather than
introducing one-off colours, and any palette change must re-run the contrast table above.
