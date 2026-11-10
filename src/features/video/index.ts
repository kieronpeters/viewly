/**
 * Public entry point for the video feature.
 *
 * The watch route composes the page around T30's player and T31's metadata
 * panel; their components are exported from here once they land.
 */
export { getWatchVideo } from "./get-watch-video";
export { getWatchChannel } from "./get-watch-channel";
export {
  MAX_SUGGESTIONS,
  getVideoSuggestions,
  selectVideoSuggestions,
  type VideoSuggestionsRequest,
} from "./video-suggestions";
