/**
 * Public entry point for the library feature (T33).
 *
 * This barrel re-exports the server-only reads, so **Client Components must not
 * import it**: importing anything here evaluates `library-data.ts` and with it
 * the `server-only` guard. Client code imports the client-safe helpers from
 * `./favourite-toggle` directly, and the action from `./actions`.
 */
export { isVideoFavourite, listFavouriteVideos } from "./library-data";
export {
  favouriteSnapshotFromVideo,
  parseFavouriteSnapshot,
  toggleFavouriteInRepository,
} from "./favourite-toggle";
export type { FavouriteSnapshot, FavouriteToggleResult } from "./favourite-toggle";
