import "server-only";

import { searchVideos } from "@/lib/youtube/client";
import type { VideoSummary } from "@/shared/types";

/**
 * Most cards the suggestions section will ever render.
 *
 * Also the requested `maxResults`, so the API call and the section agree on the
 * same bound and no candidate is fetched only to be thrown away.
 */
export const MAX_SUGGESTIONS = 8;

export interface VideoSuggestionsRequest {
  /** Channel name of the video being watched; used as the search query. */
  channelTitle: string;
  /** Id of the video being watched; always excluded from its own suggestions. */
  currentVideoId: string;
}

/**
 * Reads same-channel candidates for the watch page (T32).
 *
 * ## Strategy and its limitation
 *
 * The YouTube client has no channel filter: `searchVideos` only exposes
 * `query`, `pageToken` and `maxResults`, and `search.list` would need a
 * `channelId` parameter to ask YouTube for one channel's uploads. This module
 * therefore searches for the **channel title**, which is a title/description
 * search — not YouTube's own related-videos list, and not guaranteed to be
 * limited to the channel. The UI labels the result as a Viewly suggestion for
 * exactly that reason.
 *
 * The query is trimmed; a blank channel name yields no suggestions rather than
 * an invalid-query error. Selection (exclusion, de-duplication, cap) lives in
 * {@link selectVideoSuggestions} so it can be tested without the network.
 *
 * Deliberately not caught here: a failure propagates to the caller, which hides
 * the section without disturbing the player. Errors never carry the request URL
 * or the API key (`src/lib/youtube/client.ts`), so nothing sensitive can be
 * rendered either way.
 *
 * @throws {DomainValidationError} when the trimmed title is not a valid query.
 * @throws {YouTubeApiError} for transport, HTTP and payload failures.
 */
export async function getVideoSuggestions({
  channelTitle,
  currentVideoId,
}: VideoSuggestionsRequest): Promise<VideoSummary[]> {
  const query = channelTitle.trim();

  if (query === "") {
    return [];
  }

  const page = await searchVideos({ query, maxResults: MAX_SUGGESTIONS });

  return selectVideoSuggestions(page.items, currentVideoId);
}

/**
 * Turns a raw candidate list into the cards the section can show.
 *
 * In order: skip entries without a usable id or title, drop the video being
 * watched, drop later duplicates of an already-kept id, and stop at `limit`.
 * Order is preserved, so the caller's relevance order survives. The input is
 * never mutated and the returned array is a new one.
 */
export function selectVideoSuggestions(
  candidates: readonly VideoSummary[],
  currentVideoId: string,
  limit: number = MAX_SUGGESTIONS,
): VideoSummary[] {
  const max = Math.max(0, Math.trunc(limit));
  const seen = new Set<string>();
  const selected: VideoSummary[] = [];

  if (currentVideoId !== "") {
    seen.add(currentVideoId);
  }

  for (const candidate of candidates) {
    if (selected.length >= max) {
      break;
    }

    if (!isDisplayableSuggestion(candidate) || seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    selected.push(candidate);
  }

  return selected;
}

/**
 * Runtime guard for a candidate that reached the UI.
 *
 * Values normally come from the normalizer, but a list is cheap to defend:
 * anything without a non-blank id and title is not a card.
 */
function isDisplayableSuggestion(value: unknown): value is VideoSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<VideoSummary>;

  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    return false;
  }

  return typeof candidate.title === "string" && candidate.title.trim() !== "";
}
