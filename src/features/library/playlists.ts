/**
 * Client-safe core of the custom-playlists feature (T36).
 *
 * Like `video-snapshot.ts`, this module has **no runtime dependency** on the
 * database layer, so a Client Component may import the parsers and result types
 * without pulling `better-sqlite3` (or the `server-only` guard) into the browser
 * bundle. The server-only entry points live in `playlist-actions.ts`
 * (mutations) and `library-data.ts` (reads).
 *
 * ## Trust boundary
 *
 * Playlist names arrive through the create and rename forms; playlist ids and
 * video snapshots arrive through every mutation. Server Actions are reachable by
 * direct POST, so each action re-runs the parsers below before anything reaches
 * SQLite. The name rule itself lives in `shared/validation.ts`, next to the
 * search-query rule it mirrors.
 */
import type { VideoSummary } from "@/shared/types";
import { DomainValidationError } from "@/shared/validation";

import { parseVideoSnapshot, videoSnapshotFromVideo, type VideoSnapshot } from "./video-snapshot";

/**
 * Longest accepted playlist id.
 *
 * Ids are application-generated UUIDs (36 characters), but the repository also
 * accepts caller-supplied ids, so the guard bounds the value without assuming a
 * particular id scheme.
 */
const MAX_PLAYLIST_ID_LENGTH = 100;

/** C0 and C1 control characters, including tab, line breaks and DEL. */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/** The display snapshot a playlist item stores; shared with favourites. */
export type PlaylistSnapshot = VideoSnapshot;

/** The minimum a picker needs to render one playlist. */
export interface PlaylistOption {
  id: string;
  name: string;
}

/** What `createPlaylist` reports back; deliberately not a database row. */
export interface CreatePlaylistResult {
  playlistId: string;
  /** The normalized name that was stored. */
  name: string;
}

/** What `renamePlaylist` reports back. */
export interface RenamePlaylistResult {
  /** False when the playlist no longer exists. */
  renamed: boolean;
  /** The normalized name the caller asked for. */
  name: string;
}

/** What `deletePlaylist` reports back. */
export interface DeletePlaylistResult {
  /** False when the playlist was already gone. */
  deleted: boolean;
}

/** What `addToPlaylist` reports back. */
export interface AddToPlaylistResult {
  /** False when the playlist no longer exists. */
  added: boolean;
  playlistId: string;
  videoId: string;
}

/** What `removeFromPlaylist` reports back. */
export interface RemoveFromPlaylistResult {
  /** False when the video was not in the playlist. */
  removed: boolean;
}

/**
 * Validates a playlist id from a route parameter or an action payload.
 *
 * Ids are opaque to the client, so the guard only enforces the properties the
 * storage layer relies on: a non-empty, bounded, control-character-free string.
 */
export function parsePlaylistId(input: unknown): string {
  if (typeof input !== "string") {
    throw new DomainValidationError("invalid_type", "Playlist id must be a string.", {
      field: "playlistId",
    });
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new DomainValidationError("empty_value", "Playlist id must not be empty.", {
      field: "playlistId",
    });
  }

  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    throw new DomainValidationError(
      "control_characters",
      "Playlist id must not contain control characters.",
      { field: "playlistId" },
    );
  }

  if (Array.from(trimmed).length > MAX_PLAYLIST_ID_LENGTH) {
    throw new DomainValidationError(
      "too_long",
      `Playlist id must be at most ${MAX_PLAYLIST_ID_LENGTH} characters.`,
      { field: "playlistId" },
    );
  }

  return trimmed;
}

/** Non-throwing wrapper for route parameters, which should render a 404. */
export function tryParsePlaylistId(input: unknown): string | null {
  try {
    return parsePlaylistId(input);
  } catch {
    return null;
  }
}

/** Projects a normalized video into the snapshot a playlist item stores. */
export function playlistSnapshotFromVideo(video: VideoSummary): PlaylistSnapshot {
  return videoSnapshotFromVideo(video);
}

/** Validates and normalizes an untrusted playlist-item snapshot. */
export function parsePlaylistSnapshot(input: unknown): PlaylistSnapshot {
  return parseVideoSnapshot(input);
}
