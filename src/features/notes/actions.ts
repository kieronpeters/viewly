"use server";

/**
 * Server Actions for the local watch-page notes (T79).
 *
 * The notes panel is a private scratchpad stored in SQLite; there are no
 * accounts and no network call. Each action validates its input, performs the
 * write through the repository and revalidates the watch path so a server
 * re-render reflects the change.
 *
 * ## Why the database modules are imported inside the action
 *
 * A Server Action module is imported by a Client Component for its action
 * reference. A top-level `import "@/lib/db/client"` would execute the
 * `server-only` guard and load the native SQLite driver whenever the module is
 * evaluated outside Next's server graph (for example in Vitest, where the
 * watch-page tests render the notes panel). Loading the connection lazily
 * keeps the action inert at import time.
 *
 * ## Contract
 *
 * - {@link addNote} returns the stored note, with both timestamps set to now.
 *   Passing a `position` saves a **highlight**: the same row shape with a
 *   validated `startSeconds`, rendered in the panel's Highlights list. Omitting
 *   it saves a free-text note with `startSeconds: null`.
 * - {@link editNote} returns the updated note, or `null` when the id no longer
 *   exists (another tab deleted it). It never creates a row and never changes a
 *   highlight's timestamp; only the body and `updatedAt` change.
 * - {@link deleteNote} returns whether a row was removed; repeating it is safe.
 *   It serves both notes and highlights.
 * - Invalid input throws a `DomainValidationError` before any write happens,
 *   including a timestamp that is negative, non-finite or past the duration
 *   supplied by the player.
 *
 * The returned note carries ISO timestamps rather than `Date`s, so the client
 * stores exactly one serializable shape regardless of how the panel was
 * hydrated.
 */
import { revalidatePath } from "next/cache";

import { assertVideoId } from "@/shared/validation";

import {
  noteFromRow,
  parseNoteBody,
  parseNoteId,
  parseNoteStartSeconds,
  type NotePosition,
  type VideoNote,
} from "./notes";

/** Watch route revalidated after every successful write. */
function watchPath(videoId: string): string {
  return `/watch/${videoId}`;
}

/**
 * Creates a note for a video and returns the stored row.
 *
 * A third argument turns the note into a highlight. Its `startSeconds` is
 * validated against `durationSeconds` before the database module is even
 * loaded, so a rejected anchor never opens the connection.
 */
export async function addNote(
  videoId: string,
  body: string,
  position?: NotePosition | null,
): Promise<VideoNote> {
  const id = assertVideoId(videoId);
  const noteBody = parseNoteBody(body);
  const startSeconds = parseNoteStartSeconds(
    position?.startSeconds ?? null,
    position?.durationSeconds ?? null,
  );

  const [{ getDb }, { createNotesRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/notes.repository"),
  ]);

  const row = createNotesRepository(getDb()).create({
    videoId: id,
    body: noteBody,
    startSeconds,
    createdAt: new Date(),
  });

  revalidatePath(watchPath(id));

  return noteFromRow(row);
}

/**
 * Replaces a note's body.
 *
 * Returns `null` instead of throwing when the id is gone: a second tab may
 * have deleted the note, and the panel handles that as "this note no longer
 * exists" rather than as a save failure.
 */
export async function editNote(id: string, body: string): Promise<VideoNote | null> {
  const noteId = parseNoteId(id);
  const noteBody = parseNoteBody(body);

  const [{ getDb }, { createNotesRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/notes.repository"),
  ]);

  const updated = createNotesRepository(getDb()).update(noteId, noteBody, new Date());

  if (updated === undefined) {
    return null;
  }

  revalidatePath(watchPath(updated.videoId));

  return noteFromRow(updated);
}

/** Deletes a note. Returns `true` when a row was removed. */
export async function deleteNote(id: string): Promise<boolean> {
  const noteId = parseNoteId(id);

  const [{ getDb }, { createNotesRepository }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repositories/notes.repository"),
  ]);

  const repository = createNotesRepository(getDb());
  const note = repository.get(noteId);

  if (note === undefined) {
    return false;
  }

  const deleted = repository.delete(noteId);

  if (deleted) {
    revalidatePath(watchPath(note.videoId));
  }

  return deleted;
}
