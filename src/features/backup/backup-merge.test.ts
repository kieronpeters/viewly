// @vitest-environment node
/**
 * Merge-policy tests for T87.
 *
 * `planMerge` is pure, so these tests describe the import contract without a
 * database: natural-key identity, exact duplicates, "newer timestamp wins",
 * separate playlist-item counts, and the guarantee that local-only rows never
 * appear in an insert or update list.
 */
import { describe, expect, it } from "vitest";

import type {
  BackupData,
  BackupNote,
  BackupPlaylist,
  BackupProgress,
  BackupSavedVideo,
} from "@/features/backup/backup";
import { planMerge } from "@/features/backup/backup-merge";

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";
const D = "ddddddddddd";

function at(iso: string): Date {
  return new Date(iso);
}

function saved(videoId: string, savedAt: string, title = `Video ${videoId}`): BackupSavedVideo {
  return {
    videoId,
    title,
    channelTitle: "Channel",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    durationSeconds: 60,
    savedAt: at(savedAt),
  };
}

function note(
  id: string,
  updatedAt: string,
  body = "Body",
  startSeconds: number | null = null,
): BackupNote {
  return {
    id,
    videoId: A,
    body,
    startSeconds,
    createdAt: at("2026-01-01T00:00:00.000Z"),
    updatedAt: at(updatedAt),
  };
}

function playlist(id: string, updatedAt: string, name = id): BackupPlaylist {
  return {
    id,
    name,
    createdAt: at("2026-01-01T00:00:00.000Z"),
    updatedAt: at(updatedAt),
    items: [],
  };
}

function progress(videoId: string, updatedAt: string, positionSeconds = 10): BackupProgress {
  return {
    videoId,
    positionSeconds,
    durationSeconds: 60,
    updatedAt: at(updatedAt),
  };
}

/** A current snapshot with two of every interesting outcome. */
function currentData(): BackupData {
  return {
    favourites: [
      saved(A, "2026-01-02T00:00:00.000Z"),
      saved(B, "2026-01-05T00:00:00.000Z"),
      saved(C, "2026-01-01T00:00:00.000Z"),
    ],
    watchLater: [saved(A, "2026-02-05T00:00:00.000Z")],
    history: [
      {
        ...saved(A, "2026-01-01T00:00:00.000Z"),
        lastViewedAt: at("2026-03-05T00:00:00.000Z"),
        viewCount: 9,
      },
    ],
    playlists: [
      {
        ...playlist("playlist-one", "2026-04-05T00:00:00.000Z", "Local name"),
        items: [{ videoId: A, position: 0, addedAt: at("2026-04-01T00:00:00.000Z") }],
      },
    ],
    notes: [
      note("note-one", "2026-05-05T00:00:00.000Z", "Local body"),
      note("note-local", "2026-05-01T00:00:00.000Z"),
      note("note-newer", "2026-05-01T00:00:00.000Z", "Older body"),
    ],
    progress: [
      progress(A, "2026-06-05T00:00:00.000Z", 50),
      progress(C, "2026-06-05T00:00:00.000Z", 5),
    ],
  };
}

/** The backup being imported, with older, equal, newer and absent rows. */
function incomingData(): BackupData {
  return {
    favourites: [
      // Older than the local row: skipped.
      saved(A, "2026-01-01T00:00:00.000Z", "Stale A"),
      // Same row, same timestamp: exact duplicate, skipped.
      saved(B, "2026-01-05T00:00:00.000Z"),
      // Newer title: replaced.
      saved(C, "2026-01-10T00:00:00.000Z", "Fresh C"),
      // Absent locally: added.
      saved(D, "2026-01-11T00:00:00.000Z"),
    ],
    watchLater: [
      {
        ...saved(A, "2026-02-01T00:00:00.000Z", "Older queue"),
      },
    ],
    history: [
      {
        ...saved(A, "2026-01-01T00:00:00.000Z", "Older history"),
        lastViewedAt: at("2026-03-01T00:00:00.000Z"),
        viewCount: 2,
      },
    ],
    playlists: [
      {
        ...playlist("playlist-one", "2026-04-10T00:00:00.000Z", "Newer name"),
        items: [
          { videoId: A, position: 0, addedAt: at("2026-04-01T00:00:00.000Z") },
          { videoId: B, position: 1, addedAt: at("2026-04-02T00:00:00.000Z") },
        ],
      },
      {
        ...playlist("playlist-two", "2026-04-01T00:00:00.000Z", "New playlist"),
        items: [{ videoId: C, position: 0, addedAt: at("2026-04-03T00:00:00.000Z") }],
      },
    ],
    notes: [
      // Older: skipped.
      note("note-one", "2026-05-01T00:00:00.000Z", "Stale body"),
      // Absent: added, keeps its highlight position.
      note("note-highlight", "2026-05-02T00:00:00.000Z", "Highlight", 42),
      // Newer: replaced.
      note("note-newer", "2026-05-10T00:00:00.000Z", "Newer body"),
    ],
    progress: [
      // Older: skipped.
      progress(A, "2026-06-01T00:00:00.000Z", 10),
      // Absent: added.
      progress(D, "2026-06-02T00:00:00.000Z", 12),
      // Newer than the local row: replaced.
      progress(C, "2026-06-10T00:00:00.000Z", 30),
    ],
  };
}

describe("planMerge", () => {
  it("counts added, skipped and replaced per table", () => {
    const plan = planMerge(currentData(), incomingData());

    expect(plan.counts.favourites).toEqual({ added: 1, skipped: 2, replaced: 1 });
    expect(plan.counts.watchLater).toEqual({ added: 0, skipped: 1, replaced: 0 });
    expect(plan.counts.history).toEqual({ added: 0, skipped: 1, replaced: 0 });
    expect(plan.counts.playlists).toEqual({ added: 1, skipped: 0, replaced: 1 });
    // A and B for playlist-one, C for playlist-two. A already exists locally.
    expect(plan.counts.playlistItems).toEqual({ added: 2, skipped: 1, replaced: 0 });
    expect(plan.counts.notes).toEqual({ added: 1, skipped: 1, replaced: 1 });
    expect(plan.counts.progress).toEqual({ added: 1, skipped: 1, replaced: 1 });
    expect(plan.counts.total).toEqual({
      added: 6,
      skipped: 7,
      replaced: 4,
    });
  });

  it("keeps the newer row on a timestamp conflict and never the older one", () => {
    const plan = planMerge(currentData(), incomingData());

    expect(plan.favourites.insert.map((row) => row.videoId)).toEqual([D]);
    expect(plan.favourites.update.map((row) => row.videoId)).toEqual([C]);
    expect(plan.favourites.update[0]?.title).toBe("Fresh C");

    expect(plan.notes.update.map((row) => row.id)).toEqual(["note-newer"]);
    // `note-local` exists only locally and must not appear in any operation.
    expect(plan.notes.insert.map((row) => row.id)).toEqual(["note-highlight"]);
    expect(plan.notes.insert[0]?.startSeconds).toBe(42);

    expect(plan.progress.update.map((row) => row.videoId)).toEqual([C]);
    expect(plan.progress.update[0]?.positionSeconds).toBe(30);
  });

  it("does not touch playlist items that already exist", () => {
    const plan = planMerge(currentData(), incomingData());

    expect(plan.playlistItems.insert.map((row) => `${row.playlistId}/${row.videoId}`)).toEqual([
      "playlist-one/bbbbbbbbbbb",
      "playlist-two/ccccccccccc",
    ]);
    expect(plan.playlistItems.update).toEqual([]);
  });

  it("reports nothing when the file is an exact copy", () => {
    const data = currentData();
    const plan = planMerge(data, data);

    expect(plan.counts.total).toEqual({ added: 0, skipped: 12, replaced: 0 });
    expect(plan.favourites.insert).toEqual([]);
    expect(plan.favourites.update).toEqual([]);
    expect(plan.notes.update).toEqual([]);
    expect(plan.progress.insert).toEqual([]);
  });
});
