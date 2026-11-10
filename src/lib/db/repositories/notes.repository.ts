/**
 * Query layer for the local watch-page notes table (T79).
 *
 * ## Shape
 *
 * Like the library repository, this module exports a factory
 * ({@link createNotesRepository}) instead of a process-wide singleton. Callers
 * pass the Drizzle client they already have, and tests build their own against
 * a migrated temporary file:
 *
 * ```ts
 * import { getDb } from "@/lib/db/client";
 * import { createNotesRepository } from "@/lib/db/repositories/notes.repository";
 *
 * const notes = createNotesRepository(getDb());
 * ```
 *
 * No module here imports the connection singleton, so importing this file has
 * no I/O side effect.
 *
 * ## Time and ids
 *
 * Nothing here reads the wall clock. Every function that needs a timestamp
 * takes it as a `Date` from the caller, so tests control ordering exactly. Ids
 * are application-generated (`crypto.randomUUID()`) unless the caller supplies
 * one, matching `playlists`: a note keeps its identity across edits, and a
 * future export/import (T87) can preserve the id written on another device.
 *
 * ## Ordering
 *
 * {@link NotesRepository.listForVideo} is newest first by `created_at`, with
 * the id as a deterministic tie-break for notes created in the same
 * millisecond. Editing a note changes `updated_at`, never `created_at`, so the
 * list does not jump while the reader is editing.
 *
 * ## Validation
 *
 * Body and video-id validation belongs to the domain layer
 * (`src/features/notes/notes.ts` and `src/shared/validation.ts`); this module
 * stores what it is given. The single writer is the Server Action, which
 * validates first.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { videoNotes } from "@/db/schema";
import type { ViewlyDatabase } from "@/lib/db/client";

/** A row of `video_notes`, with the timestamps as `Date`s. */
export type VideoNoteRow = typeof videoNotes.$inferSelect;

/** Input for {@link NotesRepository.create}. */
export interface CreateVideoNoteInput {
  /** YouTube video id the note belongs to. */
  videoId: string;
  /** Plain-text body. */
  body: string;
  /** Creation time, UTC milliseconds; also the initial `updatedAt`. */
  createdAt: Date;
  /** Caller-supplied id, for example when restoring a backup (T87). */
  id?: string;
}

/** Typed query surface for `video_notes`. */
export interface NotesRepository {
  /** Inserts a note and returns the stored row. */
  create(input: CreateVideoNoteInput): VideoNoteRow;
  /**
   * Replaces a note's body and sets `updatedAt`.
   * Returns the updated row, or `undefined` when the id does not exist.
   */
  update(id: string, body: string, updatedAt: Date): VideoNoteRow | undefined;
  /** Deletes a note. Returns `true` when a row was deleted. */
  delete(id: string): boolean;
  /** One note by id, or `undefined` when it does not exist. */
  get(id: string): VideoNoteRow | undefined;
  /** One video's notes, newest first (id as a deterministic tie-break). */
  listForVideo(videoId: string): VideoNoteRow[];
}

/** Builds the typed notes query surface over an existing Drizzle client. */
export function createNotesRepository(db: ViewlyDatabase): NotesRepository {
  return {
    create(input) {
      const row = db
        .insert(videoNotes)
        .values({
          id: input.id ?? randomUUID(),
          videoId: input.videoId,
          body: input.body,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .returning()
        .get();

      if (row === undefined) {
        throw new Error(`Note for ${input.videoId} was not returned by the insert.`);
      }

      return row;
    },

    update(id, body, updatedAt) {
      return db
        .update(videoNotes)
        .set({ body, updatedAt })
        .where(eq(videoNotes.id, id))
        .returning()
        .get();
    },

    delete(id) {
      return db.delete(videoNotes).where(eq(videoNotes.id, id)).run().changes > 0;
    },

    get(id) {
      return db.select().from(videoNotes).where(eq(videoNotes.id, id)).get();
    },

    listForVideo(videoId) {
      return db
        .select()
        .from(videoNotes)
        .where(eq(videoNotes.videoId, videoId))
        .orderBy(desc(videoNotes.createdAt), desc(videoNotes.id))
        .all();
    },
  };
}
