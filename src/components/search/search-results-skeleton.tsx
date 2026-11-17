import { Skeleton } from "@/components/ui/skeleton";

/** Number of placeholder rows. */
const PLACEHOLDER_COUNT = 6;

/**
 * Streaming fallback for the search results: wide row geometry that mirrors the
 * real results, with one visually hidden status and a decorative block.
 */
export function SearchResultsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading search results…</span>
      <Skeleton className="h-4 w-40" />
      <div aria-hidden="true" className="flex flex-col gap-6">
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
          <div key={index} className="flex flex-col gap-3 sm:flex-row sm:gap-4">
            <Skeleton className="aspect-video w-full shrink-0 rounded-xl sm:w-[360px] lg:w-[500px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
              <Skeleton className="h-5 w-full max-w-xl" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
