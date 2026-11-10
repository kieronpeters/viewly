/**
 * Public entry point for the backup/restore feature (T87).
 *
 * This barrel re-exports only **client-safe** format and merge helpers. The
 * server-only service is imported directly by the route handlers, so a Client
 * Component can import the envelope types, the size limit and the merge count
 * types without pulling `better-sqlite3` into the browser bundle.
 */
export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAX_BACKUP_TEXT_LENGTH,
  buildBackupEnvelope,
  parseBackupText,
} from "./backup";
export type {
  BackupData,
  BackupEnvelope,
  BackupEnvelopeData,
  BackupHistoryEntry,
  BackupHistoryEntryJson,
  BackupNote,
  BackupNoteJson,
  BackupPlaylist,
  BackupPlaylistItem,
  BackupPlaylistItemJson,
  BackupPlaylistJson,
  BackupProgress,
  BackupProgressJson,
  BackupSavedVideo,
  BackupSavedVideoJson,
  ParsedBackup,
} from "./backup";
export { planMerge } from "./backup-merge";
export type {
  ImportCounts,
  MergeCounts,
  MergePlan,
  MergeSection,
  PlannedPlaylistItem,
} from "./backup-merge";
