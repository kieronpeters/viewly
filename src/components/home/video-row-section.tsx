import Link from "next/link";
import type * as React from "react";

import { cn } from "@/lib/utils";

export interface VideoRowSectionProps {
  /** Row title, rendered as the section heading. */
  title: string;
  /** DOM id used by the heading and the video list's `aria-labelledby`. */
  titleId: string;
  /** Optional "View all" destination, e.g. the category page for this row. */
  viewAllHref?: string;
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
 */
export function VideoRowSection({
  title,
  titleId,
  viewAllHref,
  children,
  className,
}: VideoRowSectionProps) {
  return (
    <section
      aria-labelledby={titleId}
      data-slot="video-row-section"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id={titleId}
          className="text-lg font-semibold tracking-tight text-foreground sm:text-xl"
        >
          {title}
        </h2>
        {viewAllHref === undefined ? null : (
          <Link
            href={viewAllHref}
            className="inline-flex min-h-9 items-center rounded-md text-sm font-medium text-muted-foreground underline-offset-4 transition-colors outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            View all<span className="sr-only"> {title}</span>
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
