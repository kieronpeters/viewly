// @vitest-environment node
/**
 * Round-trip and transaction tests for the T87 backup service.
 *
 * Each test uses a real, fully migrated temporary SQLite file through a mocked
 * `getDb`; `data/viewly.db` is never opened. The round-trip test exports from a
 * seeded database, imports into a second empty one and compares the envelopes
 * byte for byte. The validation tests pin the "change nothing" promise by
 * counting raw rows before and after a rejected file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbHolder } = vi.hoisted(() => ({
  /** Replaced with a migrated test client per test. */
  dbHolder: { db: undefined as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => dbHolder.db }));

import {
  BACKUP_VERSION,
  buildBackupEnvelope,
  type BackupData,
  type BackupEnvelope,
} from "@/features/backup/backup";
import {
  exportLibraryBackup,
  importLibraryBackup,
  previewLibraryBackup,
} from "@/features/backup/backup-service";
import { createBackupRepository } from "@/lib/db/repositories/backup.repository";
import { createLibraryRepository } from "@/lib/db/repositories/library.repository";
import { createNotesRepository } from "@/lib/db/repositories/notes.repository";
import { createProgressRepository } from "@/lib/db/repositories/progress.repository";
import { DomainValidationError } from "@/shared/validation";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";

const FIXED_EXPORT = new Date("2026-11-10T12:00:00.000Z");

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";

function at(iso: string): Date {
  return new Date(iso);
}

let library: TestLibraryDatabase;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
});

afterEach(() => {
  library.dispose();
});

/** Seeds every table the backup must cover, including a highlight and progress. */
function seedFullLibrary(target: TestLibraryDatabase) {
  const savedAt = at("2026-01-02T00:00:00.000Z");
  const libraryRepository = createLibraryRepository(target.db);
  const notes = createNotesRepository(target.db);
  const progress = createProgressRepository(target.db);

  libraryRepository.favourites.add({
    videoId: A,
    title: "Favourite A",
    channelTitle: "Channel A",
    thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg",
    durationSeconds: 60,
    savedAt,
  });

  libraryRepository.watchLater.add({
    videoId: B,
    title: "Queued B",
    channelTitle: "Channel B",
    thumbnailUrl: "https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg",
    durationSeconds: 120,
    savedAt: at("2026-01-03T00:00:00.000Z"),
  });

  libraryRepository.history.recordView({
    videoId: C,
    title: "Watched C",
    channelTitle: "Channel C",
    thumbnailUrl: "https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg",
    durationSeconds: null,
    viewedAt: at("2026-01-04T00:00:00.000Z"),
  });

  libraryRepository.playlists.create({
    id: "playlist-one",
    name: "Road trip",
    createdAt: at("2026-02-01T00:00:00.000Z"),
    updatedAt: at("2026-02-02T00:00:00.000Z"),
  });
  libraryRepository.playlistItems.add({
    playlistId: "playlist-one",
    videoId: A,
    addedAt: at("2026-02-03T00:00:00.000Z"),
  });

  notes.create({
    id: "note-free",
    videoId: A,
    body: "A private note",
    createdAt: at("2026-03-01T00:00:00.000Z"),
  });
  notes.create({
    id: "note-highlight",
    videoId: A,
    body: "A highlight",
    startSeconds: 83,
    createdAt: at("2026-03-02T00:00:00.000Z"),
  });
  notes.update("note-highlight", "An edited highlight", at("2026-03-03T00:00:00.000Z"));

  progress.save({
    videoId: A,
    positionSeconds: 30,
    durationSeconds: 60,
    updatedAt: at("2026-04-01T00:00:00.000Z"),
  });
}

/** Raw row count, independent of the repository under test. */
function countRows(target: TestLibraryDatabase, table: string): number {
  const row = target.sqlite.prepare(`select count(*) as count from ${table}`).get() as {
    count: number;
  };

  return row.count;
}

function counts(target: TestLibraryDatabase): Record<string, number> {
  return {
    favourites: countRows(target, "favourites"),
    watch_later: countRows(target, "watch_later"),
    history: countRows(target, "history"),
    playlists: countRows(target, "playlists"),
    playlist_items: countRows(target, "playlist_items"),
    video_notes: countRows(target, "video_notes"),
    video_progress: countRows(target, "video_progress"),
  };
}

describe("backup round trip", () => {
  it("restores every table, highlight timestamp and progress row into an empty database", () => {
    seedFullLibrary(library);

    const envelope = exportLibraryBackup(FIXED_EXPORT);
    const restored = createTestLibraryDatabase();

    try {
      dbHolder.db = restored.db;

      const result = importLibraryBackup(JSON.stringify(envelope));

      expect(result.version).toBe(BACKUP_VERSION);
      expect(result.counts.total).toEqual({ added: 8, skipped: 0, replaced: 0 });

      const exportedAgain = exportLibraryBackup(FIXED_EXPORT);

      expect(exportedAgain).toEqual(envelope);

      const data = createBackupRepository(restored.db).read();
      const highlight = data.notes.find((note) => note.id === "note-highlight");

      expect(highlight).toMatchObject({
        body: "An edited highlight",
        startSeconds: 83,
      });
      expect(data.progress).toContainEqual({
        videoId: A,
        positionSeconds: 30,
        durationSeconds: 60,
        updatedAt: at("2026-04-01T00:00:00.000Z"),
      });
    } finally {
      restored.dispose();
    }
  });
});

describe("backup validation", () => {
  it("returns a preview count without writing anything", () => {
    seedFullLibrary(library);

    const envelope = exportLibraryBackup(FIXED_EXPORT);
    const empty = createTestLibraryDatabase();

    try {
      dbHolder.db = empty.db;

      const preview = previewLibraryBackup(JSON.stringify(envelope));

      expect(preview.counts.total).toEqual({ added: 8, skipped: 0, replaced: 0 });
      expect(counts(empty)).toEqual({
        favourites: 0,
        watch_later: 0,
        history: 0,
        playlists: 0,
        playlist_items: 0,
        video_notes: 0,
        video_progress: 0,
      });
    } finally {
      empty.dispose();
    }
  });

  it("rejects a wrong version and changes nothing", () => {
    seedFullLibrary(library);
    const before = counts(library);
    const envelope = exportLibraryBackup(FIXED_EXPORT);
    const wrongVersion = JSON.stringify({ ...envelope, version: 99 });

    expect(() => importLibraryBackup(wrongVersion)).toThrow(DomainValidationError);
    expect(() => importLibraryBackup(wrongVersion)).toThrow(/Unsupported backup version/);
    expect(counts(library)).toEqual(before);
  });

  it("rejects missing envelope keys and changes nothing", () => {
    seedFullLibrary(library);
    const before = counts(library);
    const envelope = exportLibraryBackup(FIXED_EXPORT);
    const missingData = JSON.stringify({ ...envelope, data: undefined });

    expect(() => importLibraryBackup(missingData)).toThrow(DomainValidationError);
    expect(() => importLibraryBackup(missingData)).toThrow(/data must be a JSON object/);
    expect(counts(library)).toEqual(before);
  });

  it("rejects a malformed row and does not apply the valid rows before it", () => {
    seedFullLibrary(library);
    const before = counts(library);
    const envelope = exportLibraryBackup(FIXED_EXPORT);
    const broken: BackupEnvelope = {
      ...envelope,
      data: {
        ...envelope.data,
        favourites: [
          ...envelope.data.favourites,
          {
            videoId: "ddddddddddd",
            title: "Would be added",
            channelTitle: "Channel D",
            thumbnailUrl: "https://i.ytimg.com/vi/ddddddddddd/mqdefault.jpg",
            durationSeconds: 30,
            savedAt: "not-a-timestamp",
          },
        ],
      },
    };

    expect(() => importLibraryBackup(JSON.stringify(broken))).toThrow(DomainValidationError);
    expect(counts(library)).toEqual(before);
  });
});

describe("backup merge through the service", () => {
  it("keeps newer local rows, adds missing ones and reports the counts", () => {
    seedFullLibrary(library);
    const before = counts(library);
    const incoming: BackupData = {
      favourites: [
        {
          videoId: A,
          title: "Stale title",
          channelTitle: "Channel A",
          thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg",
          durationSeconds: 60,
          savedAt: at("2026-01-01T00:00:00.000Z"),
        },
        {
          videoId: B,
          title: "New favourite",
          channelTitle: "Channel B",
          thumbnailUrl: "https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg",
          durationSeconds: 120,
          savedAt: at("2026-01-09T00:00:00.000Z"),
        },
      ],
      watchLater: [],
      history: [],
      playlists: [],
      notes: [
        {
          id: "note-free",
          videoId: A,
          body: "Stale note body",
          startSeconds: null,
          createdAt: at("2026-03-01T00:00:00.000Z"),
          updatedAt: at("2026-03-01T00:00:00.000Z"),
        },
      ],
      progress: [
        {
          videoId: A,
          positionSeconds: 45,
          durationSeconds: 60,
          updatedAt: at("2026-04-05T00:00:00.000Z"),
        },
      ],
    };
    const envelope = buildBackupEnvelope(incoming, FIXED_EXPORT);

    const result = importLibraryBackup(JSON.stringify(envelope));

    expect(result.counts.favourites).toEqual({ added: 1, skipped: 1, replaced: 0 });
    expect(result.counts.notes).toEqual({ added: 0, skipped: 1, replaced: 0 });
    expect(result.counts.progress).toEqual({ added: 0, skipped: 0, replaced: 1 });
    expect(result.counts.total).toEqual({ added: 1, skipped: 2, replaced: 1 });

    const data = createBackupRepository(library.db).read();

    // Stale local favourite wins; the missing one is added.
    expect(data.favourites.find((row) => row.videoId === A)?.title).toBe("Favourite A");
    expect(data.favourites.find((row) => row.videoId === B)?.title).toBe("New favourite");
    // The stale note is skipped but the local note is never deleted.
    expect(data.notes.find((note) => note.id === "note-free")?.body).toBe("A private note");
    expect(data.notes.map((note) => note.id).sort()).toEqual(["note-free", "note-highlight"]);
    // Newer progress wins.
    expect(data.progress.find((row) => row.videoId === A)?.positionSeconds).toBe(45);

    expect(counts(library).video_notes).toBe(before.video_notes);
    expect(counts(library).playlists).toBe(before.playlists);
  });
});
