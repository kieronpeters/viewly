import Link from "next/link";
import type * as React from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { cn } from "@/lib/utils";

export interface VideoRowSectionProps {
  /** Row title, rendered as the section heading. */
  title: string;
  /**
   * Complete heading text when `title` had to be abbreviated for display.
   *
   * Set as the heading's accessible name, so assistive tech hears the full text
   * instead of the visible ellipsis. Omit it when `title` is already complete.
   */
  accessibleTitle?: string;
  /** DOM id used by the heading and the video list's `aria-labelledby`. */
  titleId: string;
  /** Optional "View all" destination, e.g. the category page for this row. */
  viewAllHref?: string;
  /**
   * Optional short explanation of why the row exists, e.g. the local signal a
   * recommendation shelf was built from. Rendered under the heading so the
   * reason is announced before the cards, but never as a second heading.
   */
  reason?: string;
  /** Row body: a `VideoRow`, or an empty/error state from `@/components/ui`. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Heading and spacing shared by every discovery row.
 *
 * Presentational only: the caller owns data, Suspense and failure handling, so
 * the heading stays in place while the row body streams in or degrades. The
 * heading keeps containing the row name, so `aria-labelledby` on the row still
 * resolves to the visible title even when a "View all" link sits beside it.
 * When the visible title is abbreviated, `accessibleTitle` restores the full
 * heading text as the heading's accessible name.
 */
export function VideoRowSection({
  title,
  accessibleTitle,
  titleId,
  viewAllHref,
  reason,
  children,
  className,
}: VideoRowSectionProps) {
  /** An identical label adds nothing; the visible heading is already complete. */
  const headingLabel = accessibleTitle === title ? undefined : accessibleTitle;

  return (
    <section
      aria-labelledby={titleId}
      data-slot="video-row-section"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id={titleId}
          aria-label={headingLabel}
          className="text-lg font-semibold tracking-tight text-foreground sm:text-xl"
        >
          {title}
        </h2>
        {viewAllHref === undefined ? null : (
          <Link
            href={viewAllHref}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline motion-reduce:transition-none",
              FOCUS_RING,
            )}
          >
            View all<span className="sr-only"> {title}</span>
          </Link>
        )}
      </div>
      {reason === undefined ? null : (
        <p className="-mt-1 text-sm text-muted-foreground">{reason}</p>
      )}
      {children}
    </section>
  );
}
