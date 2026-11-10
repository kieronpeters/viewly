import "server-only";

/**
 * Server-only reads for the local watch-page notes (T79).
 *
 * The watch page's "Your notes" panel is rendered by a Server Component
 * (`watch-discussion.tsx`), which reads the notes once and passes them into the
 * client tab widget. That keeps the panel hydrated with its content instead of
 * flashing a loading state, and keeps every note body out of a network request.
 *
 * The repository is the only query layer: nothing here builds SQL by hand.
 */
import { getDb } from "@/lib/db/client";
import { readDatabase, type DatabaseRead } from "@/lib/db/read-state";
import { createNotesRepository } from "@/lib/db/repositories/notes.repository";
import { assertVideoId } from "@/shared/validation";

import { noteFromRow, type VideoNote } from "./notes";

/** Every note for one video, newest first. */
export function listVideoNotes(videoId: string): VideoNote[] {
  const id = assertVideoId(videoId);

  return createNotesRepository(getDb())
    .listForVideo(id)
    .map((row) => noteFromRow(row));
}

/**
 * Guarded form of {@link listVideoNotes} for the watch page.
 *
 * A v0.1.0 database may not have the `video_notes` table yet. The page turns
 * that into an authored "database needs updating" state rather than a raw
 * SQLite 500.
 */
export function readVideoNotes(videoId: string): DatabaseRead<VideoNote[]> {
  return readDatabase(() => listVideoNotes(videoId));
}

/**
 * Every timestamped highlight for one video, in playback order (T90).
 *
 * The panel normally partitions the single `listVideoNotes` read it already
 * has, but this read exists for surfaces that only need the ordered highlights
 * (and for T87, which exports notes and highlights with the same row shape).
 */
export function listVideoHighlights(videoId: string): VideoNote[] {
  const id = assertVideoId(videoId);

  return createNotesRepository(getDb())
    .listHighlightsForVideo(id)
    .map((row) => noteFromRow(row));
}
