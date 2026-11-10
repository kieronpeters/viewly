/**
 * Public entry point for the home discovery feature.
 *
 * The page imports this module only. Data reads stay server-side (`home-data`
 * and `recommendations` are marked `server-only`) and the async sections own
 * their Suspense-friendly fetching, so `src/app/page.tsx` never touches the
 * YouTube client or the library repository directly.
 */
export {
  HOME_CATEGORY_SLUGS,
  getAllCategories,
  getCategoryRowVideos,
  getHomeCategories,
  getTrendingVideos,
  type HomeCategory,
} from "./home-data";
export {
  HOME_RECOMMENDATION_SHELVES,
  RecommendationShelfSection,
  type HomeRecommendationShelfDescriptor,
  type RecommendationShelfSectionProps,
} from "./recommendation-sections";
export {
  MAX_OLDEST_FAVOURITES,
  MAX_TOP_CHANNELS,
  RECOMMENDATION_CANDIDATE_LIMIT,
  RECOMMENDATION_SHELF_LIMIT,
  assembleRecommendationShelves,
  getRecommendationShelves,
  loadRecommendationShelves,
  planRecommendationShelves,
  readRecommendationSource,
  selectRecommendationSeeds,
  type RecommendationPlan,
  type RecommendationPlannedShelf,
  type RecommendationQuery,
  type RecommendationSave,
  type RecommendationSearch,
  type RecommendationSeeds,
  type RecommendationShelf,
  type RecommendationShelfKind,
  type RecommendationSource,
  type RecommendationSourceReader,
  type RecommendationView,
} from "./recommendations";
export { CategorySection, TrendingSection, type CategorySectionProps } from "./sections";
