/**
 * Public entry point for the home discovery feature.
 *
 * The page imports this module only. Data reads stay server-side (`home-data`
 * is marked `server-only`) and the async sections own their Suspense-friendly
 * fetching, so `src/app/page.tsx` never touches the YouTube client directly.
 */
export {
  HOME_CATEGORY_SLUGS,
  getAllCategories,
  getCategoryRowVideos,
  getHomeCategories,
  getTrendingVideos,
  type HomeCategory,
} from "./home-data";
export { CategorySection, TrendingSection, type CategorySectionProps } from "./sections";
