import type { Metadata } from "next";
import { Suspense } from "react";

import { CategoryChips } from "@/components/home/category-chips";
import { VideoGridSkeleton } from "@/components/home/video-grid";
import { VideoRowSkeleton } from "@/components/home/video-row-skeleton";
import {
  CategorySection,
  FeedSection,
  HOME_RECOMMENDATION_SHELVES,
  RecommendationShelfSection,
  getAllCategories,
  getHomeCategories,
} from "@/features/home";
import { ContinueWatchingSection } from "@/features/progress";

export const metadata: Metadata = {
  title: "Home · Viewly",
  description: "Trending videos, popular categories and search, all in one place.",
};

/**
 * `/` home feed.
 *
 * Shaped like the observed surface: a chip row, then a responsive 1/2/3-column
 * video grid inside its own Suspense boundary. Viewly's local shelves
 * (continue watching, recommendations) and per-category rows follow below, each
 * streaming independently so one slow or failing section never blocks the feed.
 * Search lives in the masthead, so there is no hero and no second search field.
 */
export default function Home() {
  const categories = getHomeCategories();
  const allCategories = getAllCategories();

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
      <h1 className="sr-only">Home</h1>

      <CategoryChips categories={allCategories} />

      <Suspense fallback={<VideoGridSkeleton />}>
        <FeedSection />
      </Suspense>

      <Suspense fallback={<VideoRowSkeleton title="Continue watching" />}>
        <ContinueWatchingSection titleId="home-continue-watching-heading" />
      </Suspense>

      {HOME_RECOMMENDATION_SHELVES.map((shelf) => (
        <Suspense key={shelf.kind} fallback={<VideoRowSkeleton title={shelf.skeletonTitle} />}>
          <RecommendationShelfSection kind={shelf.kind} />
        </Suspense>
      ))}

      {categories.map((category) => (
        <Suspense key={category.slug} fallback={<VideoRowSkeleton title={category.name} />}>
          <CategorySection slug={category.slug} name={category.name} />
        </Suspense>
      ))}
    </div>
  );
}
