import * as React from "react";

import { cn } from "@/lib/utils";

export type SkeletonProps = React.ComponentProps<"div">;

/**
 * A pulsing placeholder. Always pass fixed dimensions (`h-*`/`w-*`) so the
 * block reserves the same space as the content it replaces and nothing shifts.
 * Decorative: hidden from assistive technology with `aria-hidden`. The pulse is
 * suppressed when the viewer prefers reduced motion (the global rule in
 * `globals.css` covers the rest of the app's transitions as well).
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  );
}
