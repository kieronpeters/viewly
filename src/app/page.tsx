import type { Metadata } from "next";
import { Suspense } from "react";

import { ViewlyLogo } from "@/components/brand/viewly-logo";
import { CategoryChips } from "@/components/home/category-chips";
import { VideoRowSkeleton } from "@/components/home/video-row-skeleton";
import { SearchForm } from "@/components/search/search-form";
import {
  CategorySection,
  HOME_RECOMMENDATION_SHELVES,
  RecommendationShelfSection,
  TrendingSection,
  getAllCategories,
  getHomeCategories,
} from "@/features/home";
import { ContinueWatchingSection } from "@/features/progress";

export const metadata: Metadata = {
  title: "Discover · Viewly",
  description: "Trending videos, popular categories and search, all in one place.",
};

/**
 * `/` home discovery page.
 *
 * The whole page is a static shell: the hero, the browse chips, the search form
 * and one `<Suspense>` boundary per row. The first row is the local
 * continue-watching shelf (SQLite only, no YouTube call); the next three are
 * local recommendation shelves computed from history and favourites; each
 * streams and hides independently when it has nothing to show. Every row
 * component fetches behind its own boundary, so rows stream independently and a
 * slow or failing section can never block the hero or the other rows. No
 * request data is read here, and the page never imports the YouTube client
 * directly — only `@/features/home` and the progress feature.
 */
export default function Home() {
  // Static lists from the shared categories module: safe outside Suspense.
  const categories = getHomeCategories();
  const allCategories = getAllCategories();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-10 lg:px-8">
      <section aria-labelledby="home-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ViewlyLogo size="sm" />
          <span aria-hidden="true" className="h-4 w-px bg-border" />
          <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Discover
          </p>
        </div>
        <h1
          id="home-heading"
          className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl"
        >
          What do you want to watch?
        </h1>
        <p className="max-w-2xl text-balance text-muted-foreground">
          Search YouTube, or start with what is popular right now.
        </p>
        <SearchForm className="mt-1 w-full max-w-2xl" />
      </section>

      <CategoryChips categories={allCategories} />

      {/*
       * Local "Continue watching" shelf: built from SQLite only, so it costs no
       * YouTube quota. It hides itself when nothing is in progress, which is why
       * the generic row skeleton is safe as a fallback.
       */}
      <Suspense fallback={<VideoRowSkeleton title="Continue watching" />}>
        <ContinueWatchingSection titleId="home-continue-watching-heading" />
      </Suspense>

      {HOME_RECOMMENDATION_SHELVES.map((shelf) => (
        <Suspense key={shelf.kind} fallback={<VideoRowSkeleton title={shelf.skeletonTitle} />}>
          <RecommendationShelfSection kind={shelf.kind} />
        </Suspense>
      ))}

      <Suspense fallback={<VideoRowSkeleton title="Trending" />}>
        <TrendingSection />
      </Suspense>

      {categories.map((category) => (
        <Suspense key={category.slug} fallback={<VideoRowSkeleton title={category.name} />}>
          <CategorySection slug={category.slug} name={category.name} />
        </Suspense>
      ))}
    </div>
  );
}
