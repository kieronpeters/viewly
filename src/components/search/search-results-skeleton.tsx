import { Skeleton } from "@/components/ui/skeleton";

/** Number of placeholder cards; eight fills a wide grid without a second row gap. */
const PLACEHOLDER_COUNT = 8;

/**
 * Streaming fallback for the search results.
 *
 * The grid and card heights mirror the real `VideoCard` layout so the content
 * does not jump when it arrives. `Skeleton` is decorative, so the whole grid is
 * `aria-hidden` and a single visually hidden status announces the wait.
 */
export function SearchResultsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading search results…</span>
      <Skeleton className="h-4 w-40" />
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
