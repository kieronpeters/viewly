"use server";

/**
 * Server Actions for custom playlists (T36).
 *
 * The five mutations mirror the T33/T34 action module: validate every value
 * from the caller first, load the database modules lazily, perform the
 * repository operation, then revalidate the routes that render the changed
 * state. Nothing here reads the clock outside the action, so the repository
 * stays deterministic.
 *
 * ## Why the database modules are imported inside each action
 *
 * A Server Action module is imported by Client Components for its action
 * reference. A top-level `import "@/lib/db/client"` would execute the
 * `server-only` guard and load the native SQLite driver whenever the module is
 * evaluated outside Next's server graph (for example in Vitest, where the
 * picker and form tests render Client Components). Loading the connection
 * lazily keeps the actions inert at import time.
 *
 * ## Revalidation
 *
 * Every successful write revalidates `/library` (the playlist list and the
 * counts) and `/library/playlists/[playlistId]` (the detail page). A delete
 * revalidates the detail path too, so a tab still showing the removed playlist
 * gets the 404 on its next render. Creating a playlist has no detail page yet,
 * so it only revalidates the list.
 *
 * ## Idempotency
 *
 * Adding is idempotent at the storage layer (the composite primary key plus
 * `ON CONFLICT DO NOTHING`), so a double submit keeps the existing row and its
 * position. Removing reports whether a row was deleted, so a repeat remove is a
 * harmless `{ removed: false }`. Deleting relies on the schema's
 * `ON DELETE CASCADE`; the app connection enables `PRAGMA foreign_keys`, so the
 * items go with the playlist.
 */
import { revalidatePath } from "next/cache";

import { assertPlaylistName, assertVideoId } from "@/shared/validation";

import type {
  AddToPlaylistResult,
  CreatePlaylistResult,
  DeletePlaylistResult,
  PlaylistSnapshot,
  RemoveFromPlaylistResult,
  RenamePlaylistResult,
} from "./playlists";
import { parsePlaylistId, parsePlaylistSnapshot } from "./playlists";

/** Route that lists saved videos, favourites and playlists. */
const LIBRARY_PATH = "/library";

/** Detail route for one playlist; the id is already validated by the caller. */
function playlistPath(playlistId: string): string {
  return `/library/playlists/${playlistId}`;
}

/**
 * Resolves the repository for one action.
 *
 * Kept as a local helper rather than an exported function: a `"use server"`
 * module may only export async functions.
 */
async function libraryRepository() {
  const [{ getDb }, { createLibraryRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/library.repository"),
  ]);

  return createLibraryRepository(getDb());
}

/**
 * Creates an empty playlist and returns its id.
 *
 * The name is trimmed and validated before the database is touched, so an empty
 * or control-character name cannot leave a half-created row.
 */
export async function createPlaylist(name: string): Promise<CreatePlaylistResult> {
  const playlistName = assertPlaylistName(name);

  const repository = await libraryRepository();
  const now = new Date();
  const playlist = repository.playlists.create({
    name: playlistName,
    createdAt: now,
    updatedAt: now,
  });

  revalidatePath(LIBRARY_PATH);

  return { playlistId: playlist.id, name: playlist.name };
}

/**
 * Renames a playlist and reports whether it still existed.
 *
 * `updatedAt` is bumped by the repository, which moves the playlist to the top
 * of the list's "most recently modified first" order.
 */
export async function renamePlaylist(
  playlistId: string,
  name: string,
): Promise<RenamePlaylistResult> {
  const id = parsePlaylistId(playlistId);
  const playlistName = assertPlaylistName(name);

  const repository = await libraryRepository();
  const updated = repository.playlists.rename(id, playlistName, new Date());

  if (updated === undefined) {
    return { renamed: false, name: playlistName };
  }

  revalidatePath(LIBRARY_PATH);
  revalidatePath(playlistPath(id));

  return { renamed: true, name: updated.name };
}

/** Deletes a playlist; its items are removed by the schema's cascade. */
export async function deletePlaylist(playlistId: string): Promise<DeletePlaylistResult> {
  const id = parsePlaylistId(playlistId);

  const repository = await libraryRepository();
  const deleted = repository.playlists.delete(id);

  if (!deleted) {
    return { deleted: false };
  }

  revalidatePath(LIBRARY_PATH);
  revalidatePath(playlistPath(id));

  return { deleted: true };
}

/**
 * Appends a video to a playlist.
 *
 * The playlist is looked up first so a stale picker (the playlist was deleted
 * in another tab) gets `{ added: false }` instead of a foreign-key error. The
 * snapshot is validated before that read, so malformed input never reaches
 * SQLite.
 */
export async function addToPlaylist(
  playlistId: string,
  snapshot: PlaylistSnapshot,
): Promise<AddToPlaylistResult> {
  const id = parsePlaylistId(playlistId);
  const video = parsePlaylistSnapshot(snapshot);

  const repository = await libraryRepository();

  if (repository.playlists.get(id) === undefined) {
    return { added: false, playlistId: id, videoId: video.videoId };
  }

  repository.playlistItems.add({
    playlistId: id,
    videoId: video.videoId,
    addedAt: new Date(),
  });

  revalidatePath(LIBRARY_PATH);
  revalidatePath(playlistPath(id));

  return { added: true, playlistId: id, videoId: video.videoId };
}

/** Removes one video from a playlist; a repeat remove is a no-op. */
export async function removeFromPlaylist(
  playlistId: string,
  videoId: string,
): Promise<RemoveFromPlaylistResult> {
  const id = parsePlaylistId(playlistId);
  const video = assertVideoId(videoId);

  const repository = await libraryRepository();
  const removed = repository.playlistItems.remove(id, video);

  if (!removed) {
    return { removed: false };
  }

  revalidatePath(LIBRARY_PATH);
  revalidatePath(playlistPath(id));

  return { removed: true };
}
