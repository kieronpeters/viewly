/**
 * Versioned JSON backup format for the personal library (T87).
 *
 * This module is deliberately **client-safe**: it imports no database module
 * and carries no `server-only` guard, so the backup page can share the envelope
 * type, the size limit and the parser result types with the browser. The
 * server-only orchestration lives in `backup-service.ts`; the SQL lives in
 * `src/lib/db/repositories/backup.repository.ts`.
 *
 * ## File shape
 *
 * ```json
 * {
 *   "format": "viewly-library-backup",
 *   "version": 1,
 *   "exportedAt": "2026-11-10T12:00:00.000Z",
 *   "data": {
 *     "favourites": [ ... ],
 *     "watchLater": [ ... ],
 *     "history": [ ... ],
 *     "playlists": [ ... ],
 *     "notes": [ ... ],
 *     "progress": [ ... ]
 *   }
 * }
 * ```
 *
 * Every timestamp is an ISO-8601 UTC instant (`…Z`). The export serializes
 * `Date` objects with `toISOString()`, so a file produced on one device and
 * imported on another has no timezone ambiguity.
 *
 * ## Determinism
 *
 * {@link buildBackupEnvelope} sorts every list by its natural key before
 * serializing:
 *
 * - favourites, watch later, history and progress by video id;
 * - playlists by playlist id, and each playlist's items by `position` then
 *   video id;
 * - notes by note id.
 *
 * The ordering is therefore independent of SQLite's unspecified row order, so
 * two exports of the same data differ only in `exportedAt`.
 *
 * ## What is not exported
 *
 * Only library rows are copied. No API key, environment variable, cookie,
 * connection string or filesystem path is read: thumbnails are the public
 * YouTube CDN URLs already stored in a display snapshot, not local files.
 *
 * ## Validation
 *
 * {@link parseBackupText} validates the complete envelope before the caller
 * writes anything. Every failure is a `DomainValidationError` whose `field`
 * points at the offending location (`data.notes[3].startSeconds`), so the UI
 * can show a precise message. Unknown extra keys are ignored to leave room for
 * a future version; a different `version` is rejected rather than guessed at.
 */
import {
  fallbackThumbnailUrl,
  isAllowedThumbnailUrl,
  parseVideoSnapshot,
} from "@/features/library/video-snapshot";
import {
  DomainValidationError,
  assertNoteBody,
  assertPlaylistName,
  isDomainValidationError,
  isRecord,
  isVideoId,
  type DomainValidationCode,
} from "@/shared/validation";

/** Identifies the file as a Viewly library backup. */
export const BACKUP_FORMAT = "viewly-library-backup";

/** Only this envelope version is understood. */
export const BACKUP_VERSION = 1;

/**
 * Largest accepted backup text, in characters.
 *
 * The app is local-first and the library is a personal collection, so a backup
 * is normally far smaller than this. The limit stops a hostile or accidental
 * giant body from being parsed, while still leaving room for tens of thousands
 * of rows.
 */
export const MAX_BACKUP_TEXT_LENGTH = 8 * 1024 * 1024;

/** A favourite or watch-later row, with `savedAt` as a real `Date`. */
export interface BackupSavedVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  savedAt: Date;
}

/** A watch-history row. */
export interface BackupHistoryEntry {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  lastViewedAt: Date;
  viewCount: number;
}

/** One video's membership and position inside a playlist. */
export interface BackupPlaylistItem {
  videoId: string;
  position: number;
  addedAt: Date;
}

/** A playlist and its ordered items. */
export interface BackupPlaylist {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  items: BackupPlaylistItem[];
}

/** A note, or a highlight when `startSeconds` is a number. */
export interface BackupNote {
  id: string;
  videoId: string;
  body: string;
  startSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One video's local playback position. */
export interface BackupProgress {
  videoId: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: Date;
}

/** Every library table, independent of the on-disk envelope representation. */
export interface BackupData {
  favourites: BackupSavedVideo[];
  watchLater: BackupSavedVideo[];
  history: BackupHistoryEntry[];
  playlists: BackupPlaylist[];
  notes: BackupNote[];
  progress: BackupProgress[];
}

/** Serialized forms; timestamps are ISO-8601 strings in the file. */
export type BackupSavedVideoJson = Omit<BackupSavedVideo, "savedAt"> & { savedAt: string };

export type BackupHistoryEntryJson = Omit<BackupHistoryEntry, "lastViewedAt"> & {
  lastViewedAt: string;
};

export type BackupPlaylistItemJson = Omit<BackupPlaylistItem, "addedAt"> & { addedAt: string };

export type BackupPlaylistJson = Omit<BackupPlaylist, "createdAt" | "updatedAt" | "items"> & {
  createdAt: string;
  updatedAt: string;
  items: BackupPlaylistItemJson[];
};

export type BackupNoteJson = Omit<BackupNote, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export type BackupProgressJson = Omit<BackupProgress, "updatedAt"> & { updatedAt: string };

/** The serialized `data` object. */
export interface BackupEnvelopeData {
  favourites: BackupSavedVideoJson[];
  watchLater: BackupSavedVideoJson[];
  history: BackupHistoryEntryJson[];
  playlists: BackupPlaylistJson[];
  notes: BackupNoteJson[];
  progress: BackupProgressJson[];
}

/** The complete file written by `GET /api/library/backup`. */
export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: BackupEnvelopeData;
}

/** A validated envelope plus the parsed `Date` values the repository needs. */
export interface ParsedBackup {
  version: typeof BACKUP_VERSION;
  exportedAt: Date;
  data: BackupData;
}

/** Control characters rejected in identifiers and names. */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/** Note ids are application UUIDs; this is the same conservative shape as T79. */
const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Longest accepted playlist id, matching the playlist feature's parser. */
const MAX_PLAYLIST_ID_LENGTH = 100;

/** Exported timestamps are always this canonical UTC instant form. */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Parses and validates an untrusted backup string.
 *
 * Throws {@link DomainValidationError} for the first problem found. The caller
 * must call this before opening a write transaction; this function performs no
 * I/O of its own.
 */
export function parseBackupText(text: unknown): ParsedBackup {
  if (typeof text !== "string") {
    fail("invalid_type", "Backup contents must be a string.", "file");
  }

  if (text.trim().length === 0) {
    fail("empty_value", "The backup file is empty. Choose a backup JSON file.", "file");
  }

  if (text.length > MAX_BACKUP_TEXT_LENGTH) {
    fail(
      "too_long",
      `The backup file must be at most ${MAX_BACKUP_TEXT_LENGTH} characters.`,
      "file",
    );
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    fail("invalid_format", "The backup file is not valid JSON.", "file");
  }

  const envelope = readRecord(raw, "backup");

  if (envelope.format !== BACKUP_FORMAT) {
    fail(
      "invalid_format",
      "This file is not a Viewly library backup. Choose a file exported from Backup & restore.",
      "format",
    );
  }

  if (envelope.version !== BACKUP_VERSION) {
    fail(
      "invalid_format",
      `Unsupported backup version. This app can import version ${BACKUP_VERSION}, but the file says ${formatVersion(envelope.version)}.`,
      "version",
    );
  }

  const exportedAt = readIsoDate(envelope.exportedAt, "exportedAt");
  const data = readRecord(envelope.data, "data");

  const favourites = readArray(data.favourites, "data.favourites").map((row, index) =>
    readSavedVideo(row, `data.favourites[${index}]`),
  );
  const watchLater = readArray(data.watchLater, "data.watchLater").map((row, index) =>
    readSavedVideo(row, `data.watchLater[${index}]`),
  );
  const history = readArray(data.history, "data.history").map((row, index) =>
    readHistoryEntry(row, `data.history[${index}]`),
  );
  const playlists = readArray(data.playlists, "data.playlists").map((row, index) =>
    readPlaylist(row, `data.playlists[${index}]`),
  );
  const notes = readArray(data.notes, "data.notes").map((row, index) =>
    readNote(row, `data.notes[${index}]`),
  );
  const progress = readArray(data.progress, "data.progress").map((row, index) =>
    readProgress(row, `data.progress[${index}]`),
  );

  assertUnique(favourites, (row) => row.videoId, "data.favourites", "video id");
  assertUnique(watchLater, (row) => row.videoId, "data.watchLater", "video id");
  assertUnique(history, (row) => row.videoId, "data.history", "video id");
  assertUnique(playlists, (row) => row.id, "data.playlists", "playlist id");
  assertUnique(notes, (row) => row.id, "data.notes", "note id");
  assertUnique(progress, (row) => row.videoId, "data.progress", "video id");

  playlists.forEach((playlist, playlistIndex) => {
    assertUnique(
      playlist.items,
      (item) => item.videoId,
      `data.playlists[${playlistIndex}].items`,
      "video id",
    );
  });

  return {
    version: BACKUP_VERSION,
    exportedAt,
    data: { favourites, watchLater, history, playlists, notes, progress },
  };
}

/**
 * Serializes library data into the versioned envelope.
 *
 * The caller supplies `exportedAt` (the service passes the wall clock; tests
 * pass a fixed instant) so the file itself has one controlled non-deterministic
 * field. Every array is sorted before serialization.
 */
export function buildBackupEnvelope(
  data: BackupData,
  exportedAt: Date = new Date(),
): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    data: {
      favourites: [...data.favourites]
        .sort((left, right) => compareText(left.videoId, right.videoId))
        .map(savedVideoToJson),
      watchLater: [...data.watchLater]
        .sort((left, right) => compareText(left.videoId, right.videoId))
        .map(savedVideoToJson),
      history: [...data.history]
        .sort((left, right) => compareText(left.videoId, right.videoId))
        .map(historyEntryToJson),
      playlists: [...data.playlists]
        .sort((left, right) => compareText(left.id, right.id))
        .map(playlistToJson),
      notes: [...data.notes].sort((left, right) => compareText(left.id, right.id)).map(noteToJson),
      progress: [...data.progress]
        .sort((left, right) => compareText(left.videoId, right.videoId))
        .map(progressToJson),
    },
  };
}

function savedVideoToJson(row: BackupSavedVideo): BackupSavedVideoJson {
  return {
    ...row,
    thumbnailUrl: exportThumbnailUrl(row.videoId, row.thumbnailUrl),
    savedAt: row.savedAt.toISOString(),
  };
}

function historyEntryToJson(row: BackupHistoryEntry): BackupHistoryEntryJson {
  return {
    ...row,
    thumbnailUrl: exportThumbnailUrl(row.videoId, row.thumbnailUrl),
    lastViewedAt: row.lastViewedAt.toISOString(),
  };
}

/**
 * Keeps an export importable even when the stored row predates the thumbnail
 * host check (or was written by an older build).
 *
 * The backup validator accepts only the public YouTube CDN hosts that
 * `next/image` can render. A row holding `file:///…` or another host would
 * otherwise produce a file this app refuses to import, so the export writes the
 * canonical still for the video instead. The stored row itself is unchanged.
 */
function exportThumbnailUrl(videoId: string, thumbnailUrl: string): string {
  return isAllowedThumbnailUrl(thumbnailUrl) ? thumbnailUrl : fallbackThumbnailUrl(videoId);
}

function playlistToJson(row: BackupPlaylist): BackupPlaylistJson {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: [...row.items]
      .sort(
        (left, right) => left.position - right.position || compareText(left.videoId, right.videoId),
      )
      .map((item) => ({ ...item, addedAt: item.addedAt.toISOString() })),
  };
}

function noteToJson(row: BackupNote): BackupNoteJson {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function progressToJson(row: BackupProgress): BackupProgressJson {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/** Code-point comparison, independent of locale and ICU data. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail("malformed_payload", `${path} must be a JSON object.`, path);
  }

  return value;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail("invalid_type", `${path} is required and must be an array.`, path);
  }

  return value;
}

function readSavedVideo(value: unknown, path: string): BackupSavedVideo {
  const row = readRecord(value, path);
  const snapshot = readSnapshot(row, path);

  return {
    ...snapshot,
    savedAt: readIsoDate(row.savedAt, `${path}.savedAt`),
  };
}

function readHistoryEntry(value: unknown, path: string): BackupHistoryEntry {
  const row = readRecord(value, path);
  const snapshot = readSnapshot(row, path);

  return {
    ...snapshot,
    lastViewedAt: readIsoDate(row.lastViewedAt, `${path}.lastViewedAt`),
    viewCount: readInteger(row.viewCount, `${path}.viewCount`, 0),
  };
}

function readPlaylist(value: unknown, path: string): BackupPlaylist {
  const row = readRecord(value, path);
  const items = readArray(row.items, `${path}.items`).map((item, index) =>
    readPlaylistItem(item, `${path}.items[${index}]`),
  );

  return {
    id: readPlaylistId(row.id, `${path}.id`),
    name: withPath(`${path}.name`, () => assertPlaylistName(row.name)),
    createdAt: readIsoDate(row.createdAt, `${path}.createdAt`),
    updatedAt: readIsoDate(row.updatedAt, `${path}.updatedAt`),
    items,
  };
}

function readPlaylistItem(value: unknown, path: string): BackupPlaylistItem {
  const row = readRecord(value, path);

  return {
    videoId: readVideoId(row.videoId, `${path}.videoId`),
    position: readInteger(row.position, `${path}.position`, 0),
    addedAt: readIsoDate(row.addedAt, `${path}.addedAt`),
  };
}

function readNote(value: unknown, path: string): BackupNote {
  const row = readRecord(value, path);

  requireKey(row, "startSeconds", path);

  return {
    id: readNoteId(row.id, `${path}.id`),
    videoId: readVideoId(row.videoId, `${path}.videoId`),
    body: withPath(`${path}.body`, () => assertNoteBody(row.body)),
    startSeconds: readNullableInteger(row.startSeconds, `${path}.startSeconds`, 0),
    createdAt: readIsoDate(row.createdAt, `${path}.createdAt`),
    updatedAt: readIsoDate(row.updatedAt, `${path}.updatedAt`),
  };
}

function readProgress(value: unknown, path: string): BackupProgress {
  const row = readRecord(value, path);
  const durationSeconds = readInteger(row.durationSeconds, `${path}.durationSeconds`, 1);
  const positionSeconds = readInteger(row.positionSeconds, `${path}.positionSeconds`, 0);

  if (positionSeconds > durationSeconds) {
    fail(
      "out_of_range",
      `${path}.positionSeconds must not be past ${path}.durationSeconds.`,
      `${path}.positionSeconds`,
    );
  }

  return {
    videoId: readVideoId(row.videoId, `${path}.videoId`),
    positionSeconds,
    durationSeconds,
    updatedAt: readIsoDate(row.updatedAt, `${path}.updatedAt`),
  };
}

/**
 * Reuses the library snapshot validator, prefixing its field with the row path.
 * That keeps thumbnail-host and title rules identical to a normal save.
 */
function readSnapshot(
  row: Record<string, unknown>,
  path: string,
): Omit<BackupSavedVideo, "savedAt"> {
  requireKey(row, "durationSeconds", path);

  return withPath(path, () => parseVideoSnapshot(row));
}

function readVideoId(value: unknown, path: string): string {
  if (!isVideoId(value)) {
    fail("invalid_format", `${path} must be an 11-character YouTube video id.`, path);
  }

  return value;
}

function readNoteId(value: unknown, path: string): string {
  if (typeof value !== "string" || !NOTE_ID_PATTERN.test(value)) {
    fail("invalid_format", `${path} must be 1-64 URL-safe characters.`, path);
  }

  return value;
}

function readPlaylistId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("empty_value", `${path} must be a non-empty string.`, path);
  }

  if (value !== value.trim()) {
    fail("invalid_format", `${path} must not have leading or trailing whitespace.`, path);
  }

  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    fail("control_characters", `${path} must not contain control characters.`, path);
  }

  if (Array.from(value).length > MAX_PLAYLIST_ID_LENGTH) {
    fail("too_long", `${path} must be at most ${MAX_PLAYLIST_ID_LENGTH} characters.`, path);
  }

  return value;
}

function readIsoDate(value: unknown, path: string): Date {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) {
    fail(
      "invalid_format",
      `${path} must be an ISO-8601 UTC timestamp, for example 2026-11-10T12:00:00.000Z.`,
      path,
    );
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    fail("invalid_format", `${path} is not a valid date.`, path);
  }

  return date;
}

function readInteger(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail("invalid_format", `${path} must be a whole number.`, path);
  }

  if (value < minimum) {
    fail("out_of_range", `${path} must be at least ${minimum}.`, path);
  }

  return value;
}

function readNullableInteger(value: unknown, path: string, minimum: number): number | null {
  if (value === null) {
    return null;
  }

  return readInteger(value, path, minimum);
}

function requireKey(row: Record<string, unknown>, key: string, path: string): void {
  if (!Object.prototype.hasOwnProperty.call(row, key)) {
    fail("malformed_payload", `${path}.${key} is required.`, `${path}.${key}`);
  }
}

function assertUnique<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  path: string,
  label: string,
): void {
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const key = keyOf(row);

    if (seen.has(key)) {
      fail(
        "malformed_payload",
        `${path}[${index}] repeats a ${label} that already appears earlier in the file.`,
        `${path}[${index}]`,
      );
    }

    seen.add(key);
  });
}

/** Wraps a shared validator so its error names the exact row and field. */
function withPath<T>(path: string, validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (isDomainValidationError(error)) {
      const field = error.field === null ? path : `${path}.${error.field}`;

      throw new DomainValidationError(error.code, `${field}: ${error.message}`, {
        field,
        cause: error,
      });
    }

    throw error;
  }
}

function formatVersion(value: unknown): string {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : "a non-numeric value";
}

function fail(code: DomainValidationCode, message: string, field: string): never {
  throw new DomainValidationError(code, message, { field });
}
