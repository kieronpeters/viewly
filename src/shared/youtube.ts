/**
 * Normalizers for YouTube Data API responses.
 *
 * Both entry points accept `unknown`, narrow with hand-written guards and return
 * domain objects from `./types`. Unknown fields are ignored, missing optional parts
 * (thumbnails, statistics, contentDetails) degrade gracefully, and structurally
 * broken payloads throw `DomainValidationError` instead of leaking into the UI.
 */

import type {
  ChannelDetail,
  CommentPage,
  SearchPage,
  VideoComment,
  VideoDetail,
  VideoSummary,
} from "./types";
import {
  DomainValidationError,
  assertPageToken,
  isChannelId,
  isPlaylistId,
  isRecord,
  isVideoId,
} from "./validation";

/** Largest title we are willing to render; real YouTube titles are far shorter. */
const MAX_TITLE_LENGTH = 300;

/** Preferred thumbnail variants, largest first. */
const THUMBNAIL_KEYS = ["maxres", "standard", "high", "medium", "default"] as const;

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const ISO_DURATION_PATTERN = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * Normalizes a `search.list` response into a `SearchPage`.
 *
 * Items that are not videos (channels, playlists), lack a usable id, title or
 * publish date are dropped rather than surfaced half-formed.
 *
 * @throws {DomainValidationError} when the payload itself is not a search response.
 */
export function normalizeSearchResponse(payload: unknown): SearchPage {
  if (!isRecord(payload)) {
    throw malformedPayload("Search response must be an object.");
  }

  const rawItems = payload.items;
  if (!Array.isArray(rawItems)) {
    throw malformedPayload("Search response must contain an items array.");
  }

  const items: VideoSummary[] = [];
  for (const rawItem of rawItems) {
    const summary = toVideoSummary(rawItem);
    if (summary !== null) {
      items.push(summary);
    }
  }

  return {
    items,
    nextPageToken: readNextPageToken(payload, "Search response"),
    totalResults: readNonNegativeInteger(readRecord(payload, "pageInfo"), "totalResults"),
  };
}

/**
 * Normalizes a `videos.list` response into a single `VideoDetail`.
 *
 * Returns null for a well-formed response that contains no usable video, which is
 * what the API returns for missing, private or deleted ids. Malformed payloads throw.
 *
 * @throws {DomainValidationError} when the payload itself is not a video response.
 */
export function normalizeVideoResponse(payload: unknown): VideoDetail | null {
  if (!isRecord(payload)) {
    throw malformedPayload("Video response must be an object.");
  }

  const rawItems = payload.items;
  if (!Array.isArray(rawItems)) {
    throw malformedPayload("Video response must contain an items array.");
  }

  for (const rawItem of rawItems) {
    const detail = toVideoDetail(rawItem);
    if (detail !== null) {
      return detail;
    }
  }

  return null;
}

/**
 * Normalizes a `channels.list` response into a single `ChannelDetail`.
 *
 * Returns null for a well-formed response that contains no usable channel,
 * which is what the API returns for a missing or deleted id. Malformed payloads
 * throw. Only the fields the watch-page card and the channel page render
 * survive: id, title, avatar, subscriber count, description and the uploads
 * playlist id.
 *
 * @throws {DomainValidationError} when the payload itself is not a channel response.
 */
export function normalizeChannelResponse(payload: unknown): ChannelDetail | null {
  if (!isRecord(payload)) {
    throw malformedPayload("Channel response must be an object.");
  }

  const rawItems = payload.items;
  if (!Array.isArray(rawItems)) {
    throw malformedPayload("Channel response must contain an items array.");
  }

  for (const rawItem of rawItems) {
    const channel = toChannelDetail(rawItem);
    if (channel !== null) {
      return channel;
    }
  }

  return null;
}

/**
 * Normalizes a `playlistItems.list` response into video summaries.
 *
 * Playlist items are not videos: the item `id` identifies the playlist entry,
 * while the video id lives in `contentDetails.videoId` (with
 * `snippet.resourceId.videoId` as the documented alternative). The upload time
 * is `contentDetails.videoPublishedAt`, falling back to the item's
 * `snippet.publishedAt`. `playlistItems.list` returns no statistics or duration,
 * so those fields are null and the card simply omits them.
 *
 * Entries without a valid video id, a usable title or a parseable publish time
 * are dropped rather than rendered half-formed. An empty `items` array is a
 * valid empty uploads page, not an error.
 *
 * @throws {DomainValidationError} when the payload itself is not a playlist response.
 */
export function normalizePlaylistItemsResponse(payload: unknown): VideoSummary[] {
  if (!isRecord(payload)) {
    throw malformedPayload("Playlist item response must be an object.");
  }

  const rawItems = payload.items;
  if (!Array.isArray(rawItems)) {
    throw malformedPayload("Playlist item response must contain an items array.");
  }

  const items: VideoSummary[] = [];
  for (const rawItem of rawItems) {
    const summary = toPlaylistVideoSummary(rawItem);
    if (summary !== null) {
      items.push(summary);
    }
  }

  return items;
}

/**
 * Normalizes a `commentThreads.list` response into top-level comments.
 *
 * Only the fields the watch page renders survive: author, plain-text body, like
 * count, publish time and reply count. Equally important, only `textOriginal`
 * (or a tag-stripped `textDisplay` fallback) is read, so no upstream HTML is
 * carried into the UI. Threads without a usable id, author, body or timestamp
 * are dropped rather than rendered half-formed.
 *
 * The returned `commentsDisabled` is always false here: YouTube reports disabled
 * comments as a `commentsDisabled` error, which the client maps to an empty
 * disabled page before this normalizer is reached.
 *
 * @throws {DomainValidationError} when the payload itself is not a comment response.
 */
export function normalizeCommentThreadsResponse(payload: unknown): CommentPage {
  if (!isRecord(payload)) {
    throw malformedPayload("Comment response must be an object.");
  }

  const rawItems = payload.items;
  if (!Array.isArray(rawItems)) {
    throw malformedPayload("Comment response must contain an items array.");
  }

  const items: VideoComment[] = [];
  for (const rawItem of rawItems) {
    const comment = toVideoComment(rawItem);
    if (comment !== null) {
      items.push(comment);
    }
  }

  return {
    items,
    nextPageToken: readNextPageToken(payload, "Comment response"),
    commentsDisabled: false,
  };
}

/**
 * Parses an ISO-8601 duration such as "PT1H2M3S" into whole seconds.
 * Returns null for unparseable input; "P0D" (a YouTube live stream) parses to 0.
 */
export function parseIsoDuration(value: string): number | null {
  const match = ISO_DURATION_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, weeks, days, hours, minutes, seconds] = match;
  if (!weeks && !days && !hours && !minutes && !seconds) {
    return null;
  }

  // "P1DT" is structurally invalid: a T separator must be followed by a time part.
  if (value.includes("T") && !hours && !minutes && !seconds) {
    return null;
  }

  const totalSeconds =
    toNumber(weeks) * 604800 +
    toNumber(days) * 86400 +
    toNumber(hours) * 3600 +
    toNumber(minutes) * 60 +
    toNumber(seconds);

  return Number.isSafeInteger(totalSeconds) ? totalSeconds : null;
}

function toVideoSummary(rawItem: unknown): VideoSummary | null {
  if (!isRecord(rawItem)) {
    return null;
  }

  const id = readVideoId(rawItem.id);
  if (id === null) {
    return null;
  }

  const snippet = readRecord(rawItem, "snippet");
  if (snippet === null) {
    return null;
  }

  const title = readTitle(snippet);
  if (title === null) {
    return null;
  }

  const publishedAt = readIsoDate(snippet, "publishedAt");
  if (publishedAt === null) {
    return null;
  }

  return {
    id,
    title,
    channelId: readString(snippet, "channelId") ?? "",
    channelTitle: readString(snippet, "channelTitle") ?? "",
    thumbnailUrl: pickThumbnailUrl(snippet, id),
    publishedAt,
    durationSeconds: readDurationSeconds(rawItem),
    viewCount: readNonNegativeInteger(readRecord(rawItem, "statistics"), "viewCount"),
  };
}

function toVideoDetail(rawItem: unknown): VideoDetail | null {
  if (!isRecord(rawItem)) {
    return null;
  }

  const summary = toVideoSummary(rawItem);
  if (summary === null) {
    return null;
  }

  const snippet = readRecord(rawItem, "snippet");
  return {
    ...summary,
    description: readString(snippet, "description") ?? "",
  };
}

/**
 * Maps one `playlistItems.list` item to a `VideoSummary`, or null when it lacks
 * the fields a card needs. The item id is not a video id, so only the nested
 * video id is trusted; duration and view count stay null because this endpoint
 * reports neither.
 */
function toPlaylistVideoSummary(rawItem: unknown): VideoSummary | null {
  if (!isRecord(rawItem)) {
    return null;
  }

  const snippet = readRecord(rawItem, "snippet");
  if (snippet === null) {
    return null;
  }

  const title = readTitle(snippet);
  if (title === null) {
    return null;
  }

  const contentDetails = readRecord(rawItem, "contentDetails");
  const id = readVideoId(contentDetails?.videoId) ?? readVideoId(readRecord(snippet, "resourceId"));
  if (id === null) {
    return null;
  }

  const publishedAt =
    readIsoDate(contentDetails, "videoPublishedAt") ?? readIsoDate(snippet, "publishedAt");
  if (publishedAt === null) {
    return null;
  }

  return {
    id,
    title,
    channelId: readString(snippet, "channelId") ?? "",
    channelTitle: readString(snippet, "channelTitle") ?? "",
    thumbnailUrl: pickThumbnailUrl(snippet, id),
    publishedAt,
    durationSeconds: null,
    viewCount: null,
  };
}

/**
 * Maps one `channels.list` item to a `ChannelDetail`, or null when it lacks the
 * fields the card needs. A hidden subscriber count becomes null rather than 0;
 * a missing uploads playlist id becomes null rather than an empty request.
 */
function toChannelDetail(rawItem: unknown): ChannelDetail | null {
  if (!isRecord(rawItem)) {
    return null;
  }

  const id = rawItem.id;
  if (!isChannelId(id)) {
    return null;
  }

  const snippet = readRecord(rawItem, "snippet");
  if (snippet === null) {
    return null;
  }

  const title = readTitle(snippet);
  if (title === null) {
    return null;
  }

  const statistics = readRecord(rawItem, "statistics");

  return {
    id,
    title,
    avatarUrl: readChannelAvatarUrl(snippet),
    subscriberCount:
      statistics !== null && statistics.hiddenSubscriberCount !== true
        ? readNonNegativeInteger(statistics, "subscriberCount")
        : null,
    description: (readString(snippet, "description") ?? "").trim(),
    uploadsPlaylistId: readUploadsPlaylistId(rawItem),
  };
}

/**
 * Reads `contentDetails.relatedPlaylists.uploads` and keeps it only when it
 * looks like a playlist id. A missing `contentDetails` part (an older payload or
 * a caller that requested only snippet/statistics) degrades to null, which the
 * channel page renders as "uploads unavailable" rather than calling the API
 * with an empty id.
 */
function readUploadsPlaylistId(item: Record<string, unknown>): string | null {
  const uploads = readString(
    readRecord(readRecord(item, "contentDetails"), "relatedPlaylists"),
    "uploads",
  );

  return isPlaylistId(uploads) ? uploads : null;
}

/**
 * Hosts the image loader is configured for in `next.config.ts` (`remotePatterns`).
 *
 * A `channels.list` avatar from any other host is dropped here, at the trust
 * boundary, so `next/image` can never throw on the watch page: the card simply
 * draws its fallback avatar instead. Keep this list in sync with `next.config.ts`
 * — `features/library/video-snapshot.test.ts` asserts that config and its own
 * host list agree.
 */
const CHANNEL_AVATAR_HOSTS: ReadonlySet<string> = new Set(["yt3.ggpht.com"]);

/**
 * Picks the largest renderable channel avatar, or null when the snippet has no
 * https thumbnail from an allowed host. Unlike videos there is no synthetic
 * fallback URL: a channel has no `i.ytimg.com` endpoint, so the UI draws one.
 */
function readChannelAvatarUrl(snippet: Record<string, unknown>): string | null {
  const thumbnails = readRecord(snippet, "thumbnails");
  if (thumbnails === null) {
    return null;
  }

  for (const key of THUMBNAIL_KEYS) {
    const candidate = thumbnails[key];
    if (!isRecord(candidate) || !isHttpsUrl(candidate.url)) {
      continue;
    }

    let hostname: string;
    try {
      hostname = new URL(candidate.url).hostname;
    } catch {
      continue;
    }

    if (CHANNEL_AVATAR_HOSTS.has(hostname)) {
      return candidate.url;
    }
  }

  return null;
}

/**
 * Maps one `commentThread` item to a `VideoComment`, or null when it lacks the
 * fields the UI needs. `snippet.totalReplyCount` lives on the thread, while the
 * author, body and like count live on `snippet.topLevelComment.snippet`.
 */
function toVideoComment(rawItem: unknown): VideoComment | null {
  if (!isRecord(rawItem) || !isRecord(rawItem.snippet)) {
    return null;
  }

  const topLevel = readRecord(rawItem.snippet, "topLevelComment");
  const commentSnippet = readRecord(topLevel, "snippet");
  if (topLevel === null || commentSnippet === null) {
    return null;
  }

  const id = readString(topLevel, "id") ?? readString(rawItem, "id");
  if (id === null || id.trim().length === 0) {
    return null;
  }

  const author = (readString(commentSnippet, "authorDisplayName") ?? "").trim();
  const text = readCommentText(commentSnippet);
  const publishedAt = readIsoDate(commentSnippet, "publishedAt");

  if (author.length === 0 || text === null || publishedAt === null) {
    return null;
  }

  return {
    id,
    author,
    text,
    likeCount: readNonNegativeInteger(commentSnippet, "likeCount"),
    publishedAt,
    replyCount: readNonNegativeInteger(rawItem.snippet, "totalReplyCount") ?? 0,
  };
}

/**
 * Prefers the plain-text body. `textDisplay` is HTML, so the fallback strips
 * tags and decodes the handful of entities YouTube emits before it is ever
 * rendered; nothing from the payload reaches the DOM as markup.
 */
function readCommentText(snippet: Record<string, unknown>): string | null {
  const original = readString(snippet, "textOriginal");
  const text = original ?? stripHtml(readString(snippet, "textDisplay") ?? "");
  const trimmed = text.trim();

  return trimmed.length === 0 ? null : trimmed;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

/** Video ids arrive as `{ videoId }` from search and as a plain string from videos. */
function readVideoId(value: unknown): string | null {
  if (typeof value === "string") {
    return isVideoId(value) ? value : null;
  }

  if (isRecord(value) && isVideoId(value.videoId)) {
    return value.videoId;
  }

  return null;
}

function readTitle(snippet: Record<string, unknown>): string | null {
  const value = readString(snippet, "title");
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
    return null;
  }

  return trimmed;
}

/**
 * Picks the largest available https thumbnail. Falls back to YouTube's public
 * thumbnail endpoint so `thumbnailUrl` is always a usable absolute URL.
 */
function pickThumbnailUrl(snippet: Record<string, unknown>, videoId: string): string {
  const thumbnails = readRecord(snippet, "thumbnails");

  if (thumbnails !== null) {
    for (const key of THUMBNAIL_KEYS) {
      const candidate = thumbnails[key];
      if (isRecord(candidate) && isHttpsUrl(candidate.url)) {
        return candidate.url;
      }
    }
  }

  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function readDurationSeconds(item: Record<string, unknown>): number | null {
  const duration = readString(readRecord(item, "contentDetails"), "duration");
  return duration === null ? null : parseIsoDuration(duration);
}

function readNextPageToken(payload: Record<string, unknown>, label: string): string | null {
  const value = payload.nextPageToken;
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw malformedPayload(`${label} has a non-string nextPageToken.`, "nextPageToken");
  }

  // Reuses the shared token rules: absent/empty tokens become null, hostile ones throw.
  return assertPageToken(value);
}

/** Reads an ISO-8601 timestamp, rejecting free-form dates and unparseable values. */
function readIsoDate(source: Record<string, unknown> | null, key: string): string | null {
  const value = readString(source, key);
  if (value === null || !ISO_DATE_TIME_PATTERN.test(value)) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) {
    return null;
  }

  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readRecord(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (source === null) {
    return null;
  }

  const value = source[key];
  return isRecord(value) ? value : null;
}

/** Accepts a non-negative integer given as a number or a decimal string. */
function readNonNegativeInteger(
  source: Record<string, unknown> | null,
  key: string,
): number | null {
  if (source === null) {
    return null;
  }

  const value = source[key];

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value === "string" && /^\d{1,15}$/.test(value)) {
    return Number(value);
  }

  return null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function toNumber(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}

function malformedPayload(message: string, field?: string): DomainValidationError {
  return new DomainValidationError("malformed_payload", message, { field });
}
