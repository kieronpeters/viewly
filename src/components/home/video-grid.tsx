import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { VideoSummary } from "@/shared/types";

export interface VideoGridProps {
  /** Id of the heading that names this grid. */
  labelledBy: string;
  videos: readonly VideoSummary[];
  className?: string;
}

/**
 * The home/search grid: one column, then 2 at `sm` and 3 at `lg`, which is the
 * observed 1/2/3 layout at 390/768/1280. Gaps match the measured 16px column
 * and 36px row gutters.
 */
export function VideoGrid({ labelledBy, videos, className }: VideoGridProps) {
  return (
    <ul
      role="list"
      aria-labelledby={labelledBy}
      className={cn(
        "grid min-w-0 grid-cols-1 gap-x-4 gap-y-9 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {videos.map((video) => (
        <li key={video.id} className="min-w-0">
          <VideoCard video={video} className="h-full" />
        </li>
      ))}
    </ul>
  );
}

/** Placeholder grid shown while the feed streams. */
export function VideoGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading videos…</span>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-x-4 gap-y-9 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <div className="flex gap-2">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
