import { cn } from "@/lib/utils";

/**
 * Viewly brand lockup: the Aperture mark plus the "Viewly" wordmark.
 *
 * Mark concept — "Aperture": a rounded-square viewport in Midnight Purple's
 * `primary` violet with a near-black play triangle knocked into it. The tile is
 * the screen, the triangle is the act of watching, and the generous corner
 * radius keeps the shape soft against the app's rounded cards. The triangle is
 * optically centred (about 2 units right of the geometric centre) so it does
 * not look left-heavy inside the tile.
 *
 * Construction:
 * - 24 × 24 viewBox; tile spans 2–22 with a 6-unit radius.
 * - The play glyph spans roughly 9.7–18.5 horizontally and 7.2–16.9 vertically,
 *   leaving at least 3.5 units of tile on every side.
 * - Only two colours, both Midnight Purple tokens: `primary` for the tile
 *   (exposed as `currentColor` so callers can tint the whole mark) and
 *   `primary-foreground` for the play glyph.
 *
 * Sizes are fixed in pixels (24 / 32 / 40) so the mark is crisp at each common
 * header size and never scales to a fractional pixel. The component is
 * decorative: the surrounding link or landmark carries the accessible name
 * ("Viewly home"), so both the SVG and the wordmark are `aria-hidden`.
 *
 * Clear space: keep at least half the mark height free on every side — 12px for
 * the 24px mark, 16px for 32px, 20px for 40px. The wordmark gap (8/10/12px) is
 * part of the lockup and must not be tightened; nothing should enter the clear
 * space around the lockup, and the mark must not be placed on `primary` fills
 * (the play glyph would lose its contrast).
 */
export interface ViewlyLogoProps {
  /** Mark height in pixels: 24, 32 or 40. Wordmark scales with it. */
  size?: "sm" | "md" | "lg";
  /** Render only the mark — for tight rails or the mobile header. */
  markOnly?: boolean;
  className?: string;
  /** Extra classes for the mark, e.g. a different token for a dark panel. */
  markClassName?: string;
}

const SIZE_STYLES = {
  sm: { mark: "size-6", gap: "gap-2", wordmark: "text-[0.9375rem]" },
  md: { mark: "size-8", gap: "gap-2.5", wordmark: "text-lg" },
  lg: { mark: "size-10", gap: "gap-3", wordmark: "text-[1.375rem]" },
} as const;

export function ViewlyLogo({
  size = "md",
  markOnly = false,
  className,
  markClassName,
}: ViewlyLogoProps) {
  const styles = SIZE_STYLES[size];

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex select-none items-center", styles.gap, className)}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className={cn("shrink-0 text-primary", styles.mark, markClassName)}
      >
        <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" />
        <path
          d="M9.74 8.27c0-.97 1.06-1.58 1.9-1.09l6 3.74c.82.5.82 1.69 0 2.2l-6 3.74a1.27 1.27 0 0 1-1.9-1.09V8.27Z"
          className="fill-primary-foreground"
        />
      </svg>
      {markOnly ? null : (
        <span
          className={cn(
            "font-semibold leading-none tracking-[-0.03em] text-foreground",
            styles.wordmark,
          )}
        >
          Viewly
        </span>
      )}
    </span>
  );
}
