import { VideoRow } from "@/components/home/video-row";
import { VideoRowSection } from "@/components/home/video-row-section";
import { VideoCard } from "@/components/video/video-card";
import type { PlaybackPosition } from "@/features/progress/progress";

import { listContinueWatchingVideos, type ContinueWatchingItem } from "./continue-watching";

/** Row heading shared by the home and library shelves. */
export const CONTINUE_WATCHING_TITLE = "Continue watching";

/** Grid classes shared with the library's other video lists. */
const GRID_CLASSES =
  "grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export interface ContinueWatchingShelfProps {
  /** Rows from {@link listContinueWatchingVideos}; an empty list hides the shelf. */
  items: readonly ContinueWatchingItem[];
  /** DOM id for the section heading and the card list's `aria-labelledby`. */
  titleId: string;
  /**
   * Card layout: the horizontal discovery row used on home, or the 1/2/3/4
   * column grid used by the library.
   */
  layout?: "row" | "grid";
}

/**
 * Presentational "Continue watching" shelf (T72).
 *
 * Synchronous so a page that already awaited its own request data (the library)
 * can render it without introducing a second async boundary. It renders
 * nothing at all when the list is empty: no heading, no section, so an empty
 * home or library page keeps its previous shape.
 *
 * Every card gets the existing `VideoCard.progress` bar, and every field comes
 * from the stored snapshot, so this path performs no YouTube call.
 */
export function ContinueWatchingShelf({
  items,
  titleId,
  layout = "row",
}: ContinueWatchingShelfProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <VideoRowSection title={CONTINUE_WATCHING_TITLE} titleId={titleId}>
      {layout === "grid" ? (
        <ul role="list" aria-labelledby={titleId} className={GRID_CLASSES}>
          {items.map((item) => (
            <li key={item.video.id} className="min-w-0">
              <VideoCard video={item.video} progress={item.progress} className="h-full" />
            </li>
          ))}
        </ul>
      ) : (
        <ContinueWatchingRow items={items} labelledBy={titleId} />
      )}
    </VideoRowSection>
  );
}

export interface ContinueWatchingSectionProps {
  /** DOM id for the section heading and the card list's `aria-labelledby`. */
  titleId: string;
  /** Card layout: home uses the default row, the library its own grid. */
  layout?: "row" | "grid";
}

/**
 * Home-page "Continue watching" shelf.
 *
 * Async so it can own its `<Suspense>` boundary and let the hero and search form
 * paint first. The read opts into request-time rendering via `connection()`
 * inside the data module. A failed read hides the shelf instead of taking the
 * page down, matching the home recommendation shelves; the failure itself is
 * never rendered.
 */
export async function ContinueWatchingSection({
  titleId,
  layout = "row",
}: ContinueWatchingSectionProps) {
  let items: ContinueWatchingItem[];

  try {
    items = await listContinueWatchingVideos();
  } catch {
    return null;
  }

  return <ContinueWatchingShelf items={items} titleId={titleId} layout={layout} />;
}

interface ContinueWatchingRowProps {
  items: readonly ContinueWatchingItem[];
  labelledBy: string;
}

/**
 * The home row, reusing `VideoRow` for its scroll/snap layout.
 *
 * The item list becomes one progress map, so the row itself needs no knowledge
 * of continue watching: it just forwards each card's stored position to
 * `VideoCard`.
 */
function ContinueWatchingRow({ items, labelledBy }: ContinueWatchingRowProps) {
  const progressById = new Map<string, PlaybackPosition>(
    items.map((item) => [item.video.id, item.progress]),
  );

  return (
    <VideoRow
      labelledBy={labelledBy}
      videos={items.map((item) => item.video)}
      progressById={progressById}
    />
  );
}
