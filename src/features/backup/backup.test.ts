// @vitest-environment node
/**
 * Format, ordering and validation tests for the T87 backup envelope.
 *
 * These are pure tests: no database, no filesystem. They pin the wire shape,
 * the deterministic ordering that keeps round-trip diffs stable, and the
 * validation errors an incompatible file produces before any I/O.
 */
import { describe, expect, it } from "vitest";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackupEnvelope,
  parseBackupText,
  type BackupData,
} from "@/features/backup/backup";

const EXPORTED_AT = new Date("2026-11-10T12:00:00.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

/** A complete library with deliberately unsorted arrays. */
function sampleData(): BackupData {
  return {
    favourites: [
      {
        videoId: "bbbbbbbbbbb",
        title: "Second favourite",
        channelTitle: "Channel B",
        thumbnailUrl: "https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg",
        durationSeconds: 120,
        savedAt: at("2026-01-02T00:00:00.000Z"),
      },
      {
        videoId: "aaaaaaaaaaa",
        title: "First favourite",
        channelTitle: "Channel A",
        thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg",
        durationSeconds: null,
        savedAt: at("2026-01-01T00:00:00.000Z"),
      },
    ],
    watchLater: [
      {
        videoId: "ccccccccccc",
        title: "Queued",
        channelTitle: "Channel C",
        thumbnailUrl: "https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg",
        durationSeconds: 300,
        savedAt: at("2026-02-01T00:00:00.000Z"),
      },
    ],
    history: [
      {
        videoId: "aaaaaaaaaaa",
        title: "First favourite",
        channelTitle: "Channel A",
        thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg",
        durationSeconds: null,
        lastViewedAt: at("2026-03-01T00:00:00.000Z"),
        viewCount: 4,
      },
    ],
    playlists: [
      {
        id: "playlist-z",
        name: "Later",
        createdAt: at("2026-04-02T00:00:00.000Z"),
        updatedAt: at("2026-04-03T00:00:00.000Z"),
        items: [
          {
            videoId: "bbbbbbbbbbb",
            position: 1,
            addedAt: at("2026-04-04T00:00:00.000Z"),
          },
          {
            videoId: "aaaaaaaaaaa",
            position: 0,
            addedAt: at("2026-04-03T00:00:00.000Z"),
          },
        ],
      },
      {
        id: "playlist-a",
        name: "First",
        createdAt: at("2026-04-01T00:00:00.000Z"),
        updatedAt: at("2026-04-02T00:00:00.000Z"),
        items: [],
      },
    ],
    notes: [
      {
        id: "note-b",
        videoId: "bbbbbbbbbbb",
        body: "Free text",
        startSeconds: null,
        createdAt: at("2026-05-02T00:00:00.000Z"),
        updatedAt: at("2026-05-02T00:00:00.000Z"),
      },
      {
        id: "note-a",
        videoId: "aaaaaaaaaaa",
        body: "A highlight",
        startSeconds: 42,
        createdAt: at("2026-05-01T00:00:00.000Z"),
        updatedAt: at("2026-05-03T00:00:00.000Z"),
      },
    ],
    progress: [
      {
        videoId: "bbbbbbbbbbb",
        positionSeconds: 30,
        durationSeconds: 120,
        updatedAt: at("2026-06-02T00:00:00.000Z"),
      },
      {
        videoId: "aaaaaaaaaaa",
        positionSeconds: 5,
        durationSeconds: 60,
        updatedAt: at("2026-06-01T00:00:00.000Z"),
      },
    ],
  };
}

/** The envelope with a fixed export time, used for byte-for-byte comparisons. */
function sampleEnvelope() {
  return buildBackupEnvelope(sampleData(), EXPORTED_AT);
}

describe("buildBackupEnvelope", () => {
  it("writes the versioned envelope with the expected top-level fields", () => {
    const envelope = sampleEnvelope();

    expect(envelope.format).toBe(BACKUP_FORMAT);
    expect(envelope.version).toBe(BACKUP_VERSION);
    expect(envelope.exportedAt).toBe("2026-11-10T12:00:00.000Z");
    expect(Object.keys(envelope.data).sort()).toEqual([
      "favourites",
      "history",
      "notes",
      "playlists",
      "progress",
      "watchLater",
    ]);
  });

  it("orders every list deterministically regardless of input order", () => {
    const envelope = sampleEnvelope();

    expect(envelope.data.favourites.map((row) => row.videoId)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
    ]);
    expect(envelope.data.watchLater.map((row) => row.videoId)).toEqual(["ccccccccccc"]);
    expect(envelope.data.history.map((row) => row.videoId)).toEqual(["aaaaaaaaaaa"]);
    expect(envelope.data.playlists.map((row) => row.id)).toEqual(["playlist-a", "playlist-z"]);
    expect(envelope.data.playlists[1]?.items.map((row) => row.videoId)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
    ]);
    expect(envelope.data.notes.map((row) => row.id)).toEqual(["note-a", "note-b"]);
    expect(envelope.data.progress.map((row) => row.videoId)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
    ]);
  });

  it("produces the same JSON for the same data and export time", () => {
    const first = JSON.stringify(buildBackupEnvelope(sampleData(), EXPORTED_AT));
    const shuffled = sampleData();

    shuffled.favourites.reverse();
    shuffled.playlists.reverse();
    shuffled.playlists[0]?.items.reverse();
    shuffled.notes.reverse();
    shuffled.progress.reverse();

    expect(JSON.stringify(buildBackupEnvelope(shuffled, EXPORTED_AT))).toBe(first);
  });

  it("preserves a highlight's start_seconds and a progress row", () => {
    const envelope = sampleEnvelope();
    const highlight = envelope.data.notes.find((note) => note.id === "note-a");

    expect(highlight?.startSeconds).toBe(42);
    expect(envelope.data.progress).toContainEqual({
      videoId: "aaaaaaaaaaa",
      positionSeconds: 5,
      durationSeconds: 60,
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("writes no secrets, credentials or local filesystem paths", () => {
    const serialized = JSON.stringify(sampleEnvelope());

    expect(serialized).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(serialized).not.toMatch(/api[_-]?key|secret|cookie/i);
    expect(serialized).not.toMatch(/[A-Za-z]:\\/);
    expect(serialized).not.toMatch(/\/Users\/|\/home\//);
  });

  it("replaces a legacy local-path thumbnail with the public fallback", () => {
    const data = sampleData();

    data.favourites[0] = {
      ...data.favourites[0]!,
      thumbnailUrl: "file:///C:/Users/me/thumb.jpg",
    };

    const envelope = buildBackupEnvelope(data, EXPORTED_AT);
    const row = envelope.data.favourites.find((item) => item.videoId === "bbbbbbbbbbb");

    expect(row?.thumbnailUrl).toBe("https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg");
    expect(JSON.stringify(envelope)).not.toMatch(/C:\\/);
  });
});

describe("parseBackupText", () => {
  it("round-trips the exported data, including dates and highlights", () => {
    const envelope = sampleEnvelope();
    const parsed = parseBackupText(JSON.stringify(envelope));

    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.exportedAt).toEqual(EXPORTED_AT);
    expect(buildBackupEnvelope(parsed.data, EXPORTED_AT)).toEqual(envelope);
  });

  it("rejects a different envelope version", () => {
    const envelope = { ...sampleEnvelope(), version: 2 };

    expect(() => parseBackupText(JSON.stringify(envelope))).toThrow(/Unsupported backup version/);
  });

  it("rejects a missing version", () => {
    const envelope = sampleEnvelope() as unknown as Record<string, unknown>;

    delete envelope.version;

    expect(() => parseBackupText(JSON.stringify(envelope))).toThrow(/Unsupported backup version/);
  });

  it("rejects a file that is not a Viewly backup", () => {
    const envelope = sampleEnvelope() as unknown as Record<string, unknown>;

    delete envelope.format;

    expect(() => parseBackupText(JSON.stringify(envelope))).toThrow(/not a Viewly library backup/);
  });

  it("rejects a missing data key", () => {
    const envelope = sampleEnvelope();
    const broken = {
      ...envelope,
      data: { ...envelope.data, notes: undefined },
    };

    expect(() => parseBackupText(JSON.stringify(broken))).toThrow(
      /data\.notes is required and must be an array/,
    );
  });

  it("rejects an empty or non-JSON body", () => {
    expect(() => parseBackupText("   ")).toThrow(/backup file is empty/i);
    expect(() => parseBackupText("{")).toThrow(/not valid JSON/i);
  });

  it("rejects a malformed row with the field path in the message", () => {
    const envelope = sampleEnvelope();

    envelope.data.notes[0] = {
      ...envelope.data.notes[0]!,
      startSeconds: -1,
    };

    expect(() => parseBackupText(JSON.stringify(envelope))).toThrow(
      /data\.notes\[0\]\.startSeconds/,
    );
  });

  it("rejects a timestamp that is not an ISO instant", () => {
    const envelope = sampleEnvelope();

    envelope.data.progress[0] = {
      ...envelope.data.progress[0]!,
      updatedAt: "2026-06-02",
    };

    expect(() => parseBackupText(JSON.stringify(envelope))).toThrow(
      /data\.progress\[0\]\.updatedAt must be an ISO-8601 UTC timestamp/,
    );
  });

  it("rejects a thumbnail that is not an allowed https URL", () => {
    const envelope = sampleEnvelope();

    envelope.data.favourites[0] = {
      ...envelope.data.favourites[0]!,
      thumbnailUrl: "file:///C:/Users/me/thumb.jpg",
    };

    expect(() => parseBackupText(JSON.stringify(envelope))).toThrow(
      /data\.favourites\[0\].*thumbnailUrl/,
    );
  });

  it("rejects duplicate natural keys before a merge can be ambiguous", () => {
    const envelope = sampleEnvelope();

    envelope.data.notes.push({ ...envelope.data.notes[0]! });

    expect(() => parseBackupText(JSON.stringify(envelope))).toThrow(/repeats a note id/);
  });
});
