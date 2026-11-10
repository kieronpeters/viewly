import type { WatchHeatmap } from "@/features/stats";
import { formatWatchTime } from "@/features/stats/format-watch-time";
import { cn } from "@/lib/utils";

/**
 * Colour buckets for the 12-week heatmap.
 *
 * Full class names (not interpolated) so Tailwind's scanner can see every one.
 * The scale is relative: `4` is the busiest day in the current window, not an
 * absolute number of minutes.
 */
const LEVEL_CLASSES: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-muted",
  1: "bg-primary/25",
  2: "bg-primary/45",
  3: "bg-primary/70",
  4: "bg-primary",
};

export interface WatchHeatmapGridProps {
  heatmap: WatchHeatmap;
}

/**
 * 12-week, 84-cell heatmap of estimated watch time.
 *
 * The grid is exposed as a single image with a summary label instead of 84
 * list items: a screen reader should hear "14 active days, 4h 20m estimated",
 * not every empty square. Each cell still carries a `title` for pointer users.
 * Columns are weeks oldest-first because `grid-flow-col` with seven rows fills
 * the flattened day list top-to-bottom, then left-to-right.
 */
export function WatchHeatmapGrid({ heatmap }: WatchHeatmapGridProps) {
  const total = formatWatchTime(heatmap.estimatedWatchSeconds) ?? "0m";

  return (
    <figure className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={`Watch activity for the last ${heatmap.weeks.length} weeks: ${heatmap.activeDayCount} active ${heatmap.activeDayCount === 1 ? "day" : "days"}, ${total} estimated.`}
        className="grid grid-flow-col grid-rows-7 gap-1"
      >
        {heatmap.days.map((day) => {
          const label =
            day.level === 0
              ? `${day.day}: no activity`
              : `${day.day}: ${formatWatchTime(day.estimatedWatchSeconds) ?? "0m"} estimated`;

          return (
            <span
              key={day.day}
              aria-hidden="true"
              title={label}
              className={cn("size-3 rounded-[2px] sm:size-4", LEVEL_CLASSES[day.level])}
            />
          );
        })}
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Each square is one UTC day, oldest first.</span>
        <span className="inline-flex items-center gap-1" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={cn("size-2.5 rounded-[2px]", LEVEL_CLASSES[level as 0 | 1 | 2 | 3 | 4])}
            />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}
