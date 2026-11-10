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

/**
 * A channel as shown on the watch page (T74).
 *
 * Deliberately thin: what the watch-page card and `/channel/[id]` render.
 * `avatarUrl` is null when the source published no usable https thumbnail (or
 * one from a host the image loader cannot serve), so the UI draws its fallback
 * instead. The subscriber count is null when YouTube hides it or does not
 * return one; it is never guessed. `uploadsPlaylistId` is the one link the
 * channel page needs to list recent uploads without a second `channels.list`.
 */
export interface ChannelDetail {
  /** Channel id, always the `UC…` form from `snippet.channelId`. */
  id: string;
  /** Display name, trimmed and non-empty. */
  title: string;
  /** Absolute https avatar URL, or null when none is renderable. */
  avatarUrl: string | null;
  /** Subscriber count when published, otherwise null. */
  subscriberCount: number | null;
  /**
   * Channel description as published, trimmed. Empty when the snippet has none;
   * never null, so the channel page can render or omit one field without a guard.
   */
  description: string;
  /**
   * Uploads playlist id from `contentDetails.relatedPlaylists.uploads`, or null
   * when YouTube did not return one (or it is not a plausible playlist id).
   * The channel page uses it for `playlistItems.list`; null means "no uploads
   * grid", never "the channel has no videos".
   */
  uploadsPlaylistId: string | null;
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
 * One top-level YouTube comment, read-only.
 *
 * This is display data only: it is held in the process cache for at most five
 * minutes and is never written to the database, localStorage or a log. `text`
 * is plain text (never upstream HTML) and is rendered through React text nodes.
 */
export interface VideoComment {
  /** Comment id, used as the list key. Never empty. */
  id: string;
  /** Display name of the comment author. Never empty. */
  author: string;
  /** Plain-text body. Never interpreted as HTML. */
  text: string;
  /** Null when the source did not provide a like count. */
  likeCount: number | null;
  publishedAt: IsoDateTime;
  /** Number of replies reported by YouTube; 0 when absent. */
  replyCount: number;
}

/**
 * One page of top-level comments for a video.
 *
 * `commentsDisabled` is a normal outcome, not an error: YouTube refuses
 * `commentThreads.list` for videos whose owner turned comments off, so the
 * client models it as an empty page the UI can explain instead of a failure.
 */
export interface CommentPage {
  items: VideoComment[];
  /** Token for the next page, or null when this is the last page. */
  nextPageToken: string | null;
  /** True when the video's comments are disabled or otherwise unavailable. */
  commentsDisabled: boolean;
}

/** A playlist as shown in a list. Kept minimal; extend when persistence lands. */
export interface PlaylistSummary {
  id: string;
  name: string;
  itemCount: number;
}
