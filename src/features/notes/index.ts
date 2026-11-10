/**
 * Public entry point for the local watch-page notes feature (T79).
 *
 * This barrel re-exports the server-only read, so **Client Components must not
 * import it**: importing anything here evaluates `notes-data.ts` and with it
 * the `server-only` guard. Client code imports the client-safe helpers from
 * `./notes` directly and the actions from `./actions`.
 *
 * The notes table is part of the local data that T87's export/import will
 * carry, alongside the library tables; nothing here writes outside SQLite.
 * T90 added the nullable `start_seconds` column, so the export carries notes
 * and highlights in one row shape: a `null` timestamp is a free-text note, a
 * number is a highlight anchored to that playback position.
 */
export { listVideoHighlights, listVideoNotes } from "./notes-data";
export {
  formatNoteTimestamp,
  noteFromRow,
  parseNoteBody,
  parseNoteId,
  parseNoteStartSeconds,
  partitionVideoNotes,
} from "./notes";
export type { NotePosition, VideoNote } from "./notes";
