/**
 * Shared domain types for Viewly.
 *
 * These types describe data that has already crossed the trust boundary in
 * `src/shared/youtube.ts`. Never build one of these objects directly from an
 * `unknown` payload: normalize it first, so malformed data cannot reach the UI.
 */

/** ISO-8601 timestamp string, e.g. "2024-05-01T12:00:00Z". */
export type IsoDateTime = string;

/** A video as it appears in any list (search results, library, playlist). */
export interface VideoSummary {
  /** YouTube video id, always 11 URL-safe characters. */
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  /** Absolute https URL. Never empty at runtime. */
  thumbnailUrl: string;
  publishedAt: IsoDateTime;
  /** Null when the source did not provide a parseable duration. */
  durationSeconds: number | null;
  /** Null when the source did not provide a view count. */
  viewCount: number | null;
}

/**
 * A single video on the watch page.
 * Intentionally thin: add fields here only when the watch page actually reads them.
 */
export interface VideoDetail extends VideoSummary {
  /** Full description as provided by the source. Empty string when absent. */
  description: string;
}

/** One page of search results. */
export interface SearchPage {
  items: VideoSummary[];
  /** Token for the next page, or null when this is the last page. */
  nextPageToken: string | null;
  /** Null when the source did not provide a result count. */
  totalResults: number | null;
}

/**
 * A video saved to the local library.
 * Snapshot of the video identity plus when it was saved; timestamps are ISO-8601.
 */
export interface LibraryItem {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  savedAt: IsoDateTime;
}

/** A playlist as shown in a list. Kept minimal; extend when persistence lands. */
export interface PlaylistSummary {
  id: string;
  name: string;
  itemCount: number;
}

/** A playlist with its saved videos, oldest saved first. */
export interface PlaylistDetail {
  id: string;
  name: string;
  items: LibraryItem[];
}
