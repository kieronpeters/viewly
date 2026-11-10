import { VideoRow } from "@/components/home/video-row";
import { VideoRowSection } from "@/components/home/video-row-section";

import {
  getRecommendationShelves,
  type RecommendationShelf,
  type RecommendationShelfKind,
} from "./recommendations";

/** Static description of one home recommendation row. */
export interface HomeRecommendationShelfDescriptor {
  /** Which locally computed shelf this boundary renders. */
  kind: RecommendationShelfKind;
  /**
   * Heading reserved by the streaming skeleton.
   *
   * The real heading can include a video title (`Because you watched …`), which
   * is unknown until the data arrives. The skeleton therefore announces a
   * generic, stable label instead: if the shelf ends up hidden, no title flashes
   * and then disappears.
   */
  skeletonTitle: string;
}

/**
 * Recommendation rows in display order, most personal first.
 *
 * The page maps this list to one `<Suspense>` boundary per row, so each shelf
 * streams independently. The order is also the cross-shelf priority used by
 * {@link assembleRecommendationShelves}.
 */
export const HOME_RECOMMENDATION_SHELVES: readonly HomeRecommendationShelfDescriptor[] = [
  { kind: "because-you-watched", skeletonTitle: "Because you watched" },
  { kind: "top-channels", skeletonTitle: "More from your top channels" },
  { kind: "rediscover-favourites", skeletonTitle: "Rediscover your favourites" },
];

export interface RecommendationShelfSectionProps {
  /** Shelf to render; must match an entry in {@link HOME_RECOMMENDATION_SHELVES}. */
  kind: RecommendationShelfKind;
}

/**
 * One local recommendation shelf.
 *
 * Async so it can sit inside its own `<Suspense>` boundary and let the hero,
 * chips and other rows paint first. The shared loader is request-cached, so the
 * three sections together still read the library once and search each unique
 * query once.
 *
 * Recommendations are an enhancement: an unexpected failure, or a shelf with no
 * usable cards after exclusions, hides the whole section including its heading.
 * Nothing about the failure is rendered, so an upstream URL or API key can never
 * leak through this path.
 */
export async function RecommendationShelfSection({ kind }: RecommendationShelfSectionProps) {
  let shelves: RecommendationShelf[];

  try {
    shelves = await getRecommendationShelves();
  } catch {
    return null;
  }

  const shelf = shelves.find((candidate) => candidate.kind === kind);
  if (shelf === undefined) {
    return null;
  }

  const titleId = `home-${kind}-heading`;

  return (
    <VideoRowSection
      title={shelf.title}
      accessibleTitle={shelf.fullTitle}
      titleId={titleId}
      reason={shelf.reason}
    >
      <VideoRow labelledBy={titleId} videos={shelf.videos} />
    </VideoRowSection>
  );
}
