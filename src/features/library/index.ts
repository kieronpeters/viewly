/**
 * Public entry point for the library feature (T33/T34/T36).
 *
 * This barrel re-exports the server-only reads, so **Client Components must not
 * import it**: importing anything here evaluates `library-data.ts` and with it
 * the `server-only` guard. Client code imports the client-safe helpers from
 * `./favourite-toggle`, `./watch-later-toggle` and `./playlists` directly, and
 * the actions from `./actions` / `./playlist-actions`.
 */
export {
  getPlaylistForPage,
  isInWatchLater,
  isVideoFavourite,
  listFavouriteVideos,
  listPlaylists,
  listWatchLaterVideos,
} from "./library-data";
export type { PlaylistPageData } from "./library-data";
export { countLibraryEntries } from "./library-counts";
export type { LibraryCounts } from "./library-counts";
export { sweepLibraryMetadata } from "./metadata-sweep";
export type { SweepResult, SweepStatus } from "./metadata-sweep";
export {
  favouriteSnapshotFromVideo,
  parseFavouriteSnapshot,
  toggleFavouriteInRepository,
} from "./favourite-toggle";
export type { FavouriteSnapshot, FavouriteToggleResult } from "./favourite-toggle";
export {
  parseWatchLaterSnapshot,
  toggleWatchLaterInRepository,
  watchLaterSnapshotFromVideo,
} from "./watch-later-toggle";
export type { WatchLaterSnapshot, WatchLaterToggleResult } from "./watch-later-toggle";
