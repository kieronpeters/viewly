import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder cards per row: enough to fill a wide grid without a second line. */
const PLACEHOLDER_COUNT = 4;

export interface VideoRowSkeletonProps {
  /** Row name, announced to assistive technology while the row loads. */
  title: string;
}

/**
 * Streaming fallback for a discovery row.
 *
 * Mirrors `VideoRow`: horizontal cards on mobile, the same 2/3/4-column grid
 * from `sm` up, with the heading reserved at its final height so the page does
 * not shift when the real row arrives.
 */
export function VideoRowSkeleton({ title }: VideoRowSkeletonProps) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading {title}…</span>
      <Skeleton className="h-7 w-32" />
      <div
        aria-hidden="true"
        className="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-6 sm:px-0 lg:grid-cols-3 xl:grid-cols-4"
      >
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
          <div key={index} className="flex w-60 shrink-0 flex-col gap-2 sm:w-auto">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
