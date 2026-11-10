/**
 * The one focus treatment for interactive surfaces.
 *
 * Cards, save controls and list rows all sit on different surfaces, so a single
 * shared constant keeps the 2px `--ring` outline, its 2px offset and the offset
 * colour identical everywhere. The offset colour is the canvas, which matches
 * every surface a control can sit on (the card and panel backgrounds are close
 * enough that the ring still clears the 3:1 focus-indicator requirement).
 *
 * Kept as a string rather than a CSS utility so structural tests can assert the
 * exact classes and `cn`/tailwind-merge can still dedupe conflicting utilities.
 */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
