// @vitest-environment node
/**
 * Contract tests for the local notes Server Actions (T79).
 *
 * The actions run against a real migrated SQLite file: only `getDb` and
 * `revalidatePath` are mocked. That keeps the assertions about stored state
 * honest (the migration, the repository and the action compose for real) while
 * `next/cache` stays out of a plain Vitest process, which has no request
 * context to revalidate.
 *
 * The database modules are loaded lazily inside the actions; Vitest's module
 * mocks intercept dynamic imports too, so `getDb` resolves to the fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePathMock, dbHolder } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  /** Replaced with the migrated test client in `beforeEach`. */
  dbHolder: { db: undefined as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/db/client", () => ({ getDb: () => dbHolder.db }));

import { listVideoHighlights, listVideoNotes } from "@/features/notes/notes-data";
import {
  createNotesRepository,
  type NotesRepository,
} from "@/lib/db/repositories/notes.repository";
import { DomainValidationError, MAX_NOTE_BODY_LENGTH } from "@/shared/validation";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import { addNote, deleteNote, editNote } from "./actions";
import { formatNoteTimestamp } from "./notes";

const VIDEO_ID = "dQw4w9WgXcQ";
const OTHER_VIDEO_ID = "9bZkp7q19f0";

let library: TestLibraryDatabase;
let notes: NotesRepository;

beforeEach(() => {
  library = createTestLibraryDatabase();
  dbHolder.db = library.db;
  notes = createNotesRepository(library.db);
  revalidatePathMock.mockReset();
});

afterEach(() => {
  library.dispose();
});

/** Raw row count, independent of the repository under test. */
function countRows(): number {
  const row = library.sqlite.prepare("select count(*) as count from video_notes").get() as {
    count: number;
  };

  return row.count;
}

describe("addNote", () => {
  it("stores a trimmed note with matching timestamps and revalidates the watch path", async () => {
    const result = await addNote(VIDEO_ID, "  Rewatch the middle section.  ");

    expect(result).toMatchObject({ videoId: VIDEO_ID, body: "Rewatch the middle section." });
    expect(result.id).toEqual(expect.any(String));
    expect(result.createdAt).toBe(result.updatedAt);
    expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false);
    expect(formatNoteTimestamp(result.createdAt)).not.toBeNull();

    const stored = notes.get(result.id);
    expect(stored).toMatchObject({ videoId: VIDEO_ID, body: "Rewatch the middle section." });
    expect(stored?.createdAt).toEqual(stored?.updatedAt);
    expect(countRows()).toBe(1);
    expect(revalidatePathMock.mock.calls).toEqual([[`/watch/${VIDEO_ID}`]]);
  });

  it("keeps line breaks and normalizes Windows line endings", async () => {
    await expect(addNote(VIDEO_ID, "First point\r\nSecond point")).resolves.toMatchObject({
      body: "First point\nSecond point",
    });
  });

  it("accepts a body at the 2000-character limit", async () => {
    const body = "a".repeat(MAX_NOTE_BODY_LENGTH);

    await expect(addNote(VIDEO_ID, body)).resolves.toMatchObject({ body });
    expect(countRows()).toBe(1);
  });

  it("rejects an invalid video id before writing or revalidating", async () => {
    await expect(addNote("not-a-video-id", "A note")).rejects.toBeInstanceOf(DomainValidationError);

    expect(countRows()).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an empty or whitespace-only body before writing", async () => {
    await expect(addNote(VIDEO_ID, "")).rejects.toMatchObject({
      code: "empty_value",
      field: "noteBody",
    });
    await expect(addNote(VIDEO_ID, "   \n\t  ")).rejects.toMatchObject({ code: "empty_value" });

    expect(countRows()).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a body longer than 2000 code points", async () => {
    await expect(addNote(VIDEO_ID, "a".repeat(MAX_NOTE_BODY_LENGTH + 1))).rejects.toMatchObject({
      code: "too_long",
      field: "noteBody",
    });

    expect(countRows()).toBe(0);
  });

  it("rejects unsupported control characters but allows tabs", async () => {
    await expect(addNote(VIDEO_ID, "null\u0000byte")).rejects.toMatchObject({
      code: "control_characters",
    });

    await expect(addNote(VIDEO_ID, "Column\tvalue")).resolves.toMatchObject({
      body: "Column\tvalue",
    });
  });

  it("saves a highlight with the validated start position", async () => {
    const result = await addNote(VIDEO_ID, "The example starts here.", {
      startSeconds: 83,
      durationSeconds: 213,
    });

    expect(result).toMatchObject({
      videoId: VIDEO_ID,
      body: "The example starts here.",
      startSeconds: 83,
    });
    expect(notes.get(result.id)?.startSeconds).toBe(83);
    expect(listVideoNotes(VIDEO_ID)[0]?.startSeconds).toBe(83);
    expect(countRows()).toBe(1);
    expect(revalidatePathMock.mock.calls).toEqual([[`/watch/${VIDEO_ID}`]]);
  });

  it("floors a fractional player position to whole seconds", async () => {
    const result = await addNote(VIDEO_ID, "Fractional.", {
      startSeconds: 82.9,
      durationSeconds: 213.9,
    });

    expect(result.startSeconds).toBe(82);
    expect(notes.get(result.id)?.startSeconds).toBe(82);
  });

  it("accepts the start and the exact end of the video", async () => {
    await expect(
      addNote(VIDEO_ID, "At the start.", { startSeconds: 0, durationSeconds: 213 }),
    ).resolves.toMatchObject({ startSeconds: 0 });

    await expect(
      addNote(VIDEO_ID, "At the end.", { startSeconds: 213, durationSeconds: 213 }),
    ).resolves.toMatchObject({ startSeconds: 213 });
  });

  it("allows a position when the duration is not known yet", async () => {
    await expect(
      addNote(VIDEO_ID, "Live stream.", { startSeconds: 9_000, durationSeconds: 0 }),
    ).resolves.toMatchObject({ startSeconds: 9_000 });
  });

  it("saves a free-text note without a timestamp", async () => {
    const result = await addNote(VIDEO_ID, "No anchor.");

    expect(result.startSeconds).toBeNull();
    expect(notes.get(result.id)?.startSeconds).toBeNull();
  });

  it("rejects a timestamp past the video duration before writing", async () => {
    await expect(
      addNote(VIDEO_ID, "Past the end.", { startSeconds: 214, durationSeconds: 213 }),
    ).rejects.toMatchObject({ code: "out_of_range", field: "startSeconds" });

    expect(countRows()).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a negative, non-finite or non-numeric timestamp before writing", async () => {
    await expect(
      addNote(VIDEO_ID, "Negative.", { startSeconds: -1, durationSeconds: 213 }),
    ).rejects.toMatchObject({ code: "out_of_range", field: "startSeconds" });

    await expect(
      addNote(VIDEO_ID, "NaN.", { startSeconds: Number.NaN, durationSeconds: 213 }),
    ).rejects.toMatchObject({ code: "invalid_format", field: "startSeconds" });

    await expect(
      addNote(VIDEO_ID, "String.", {
        startSeconds: "83" as unknown as number,
        durationSeconds: 213,
      }),
    ).rejects.toMatchObject({ code: "invalid_type", field: "startSeconds" });

    expect(countRows()).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("editNote", () => {
  it("replaces the body, bumps updatedAt, keeps id and createdAt, and revalidates", async () => {
    const created = notes.create({
      videoId: VIDEO_ID,
      body: "Original",
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    const result = await editNote(created.id, "  Revised  ");

    expect(result).toMatchObject({ id: created.id, videoId: VIDEO_ID, body: "Revised" });
    expect(result?.createdAt).toBe("2000-01-01T00:00:00.000Z");
    expect(result?.updatedAt).not.toBe(result?.createdAt);
    expect(Date.parse(result!.updatedAt)).toBeGreaterThan(Date.parse(result!.createdAt));

    expect(notes.get(created.id)).toMatchObject({ body: "Revised" });
    expect(countRows()).toBe(1);
    expect(revalidatePathMock.mock.calls).toEqual([[`/watch/${VIDEO_ID}`]]);
  });

  it("returns null for an unknown id without creating a row", async () => {
    await expect(editNote("missing-note", "Body")).resolves.toBeNull();

    expect(countRows()).toBe(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid id or body before writing", async () => {
    const created = notes.create({
      videoId: VIDEO_ID,
      body: "Original",
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    await expect(editNote("bad id!", "Body")).rejects.toBeInstanceOf(DomainValidationError);
    await expect(editNote(created.id, "   ")).rejects.toBeInstanceOf(DomainValidationError);

    expect(notes.get(created.id)).toMatchObject({ body: "Original" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("does not reorder the video's notes when a note is edited", async () => {
    const older = notes.create({
      videoId: VIDEO_ID,
      body: "Older",
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    const newer = notes.create({
      videoId: VIDEO_ID,
      body: "Newer",
      createdAt: new Date("2000-01-02T00:00:00.000Z"),
    });

    await editNote(older.id, "Older, revised");

    expect(listVideoNotes(VIDEO_ID).map((note) => note.id)).toEqual([newer.id, older.id]);
    expect(listVideoNotes(VIDEO_ID)[1]?.body).toBe("Older, revised");
  });

  it("keeps a highlight's timestamp when only its body is edited", async () => {
    const created = notes.create({
      videoId: VIDEO_ID,
      body: "Original highlight",
      startSeconds: 83,
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    const result = await editNote(created.id, "Revised highlight");

    expect(result).toMatchObject({ id: created.id, startSeconds: 83, body: "Revised highlight" });
    expect(notes.get(created.id)?.startSeconds).toBe(83);
    expect(listVideoHighlights(VIDEO_ID).map((note) => note.startSeconds)).toEqual([83]);
  });
});

describe("deleteNote", () => {
  it("removes only the requested note and revalidates its video", async () => {
    const target = notes.create({
      videoId: VIDEO_ID,
      body: "Remove me",
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    const keeper = notes.create({
      videoId: VIDEO_ID,
      body: "Keep me",
      createdAt: new Date("2000-01-02T00:00:00.000Z"),
    });
    notes.create({
      videoId: OTHER_VIDEO_ID,
      body: "Other video",
      createdAt: new Date("2000-01-03T00:00:00.000Z"),
    });

    await expect(deleteNote(target.id)).resolves.toBe(true);

    expect(notes.get(target.id)).toBeUndefined();
    expect(notes.get(keeper.id)).toBeDefined();
    expect(listVideoNotes(OTHER_VIDEO_ID)).toHaveLength(1);
    expect(revalidatePathMock.mock.calls).toEqual([[`/watch/${VIDEO_ID}`]]);
  });

  it("is a safe no-op for an unknown id and does not revalidate", async () => {
    await expect(deleteNote("missing-note")).resolves.toBe(false);

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before querying", async () => {
    await expect(deleteNote("bad id!")).rejects.toBeInstanceOf(DomainValidationError);

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("listVideoNotes", () => {
  it("returns one video's notes newest first and leaves other videos alone", () => {
    const first = notes.create({
      videoId: VIDEO_ID,
      body: "First",
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    const second = notes.create({
      videoId: VIDEO_ID,
      body: "Second",
      createdAt: new Date("2000-01-02T00:00:00.000Z"),
    });
    const other = notes.create({
      videoId: OTHER_VIDEO_ID,
      body: "Other",
      createdAt: new Date("2000-01-03T00:00:00.000Z"),
    });

    expect(listVideoNotes(VIDEO_ID).map((note) => note.id)).toEqual([second.id, first.id]);
    expect(listVideoNotes(VIDEO_ID).map((note) => note.body)).toEqual(["Second", "First"]);
    expect(listVideoNotes("aaaaaaaaaaa")).toEqual([]);
    expect(notes.get(other.id)).toBeDefined();
  });

  it("uses the id as a deterministic tie-break for notes in the same millisecond", () => {
    const at = new Date("2000-01-01T00:00:00.000Z");
    notes.create({ id: "note-a", videoId: VIDEO_ID, body: "A", createdAt: at });
    notes.create({ id: "note-b", videoId: VIDEO_ID, body: "B", createdAt: at });

    expect(listVideoNotes(VIDEO_ID).map((note) => note.id)).toEqual(["note-b", "note-a"]);
  });

  it("rejects a malformed video id instead of reading another video's notes", () => {
    expect(() => listVideoNotes("not-a-video-id")).toThrow(DomainValidationError);
  });
});

describe("listVideoHighlights", () => {
  it("returns only timestamped notes, ordered by playback time", () => {
    const late = notes.create({
      videoId: VIDEO_ID,
      body: "Late",
      startSeconds: 200,
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    const early = notes.create({
      videoId: VIDEO_ID,
      body: "Early",
      startSeconds: 30,
      createdAt: new Date("2000-01-02T00:00:00.000Z"),
    });
    notes.create({
      videoId: VIDEO_ID,
      body: "Free text",
      createdAt: new Date("2000-01-03T00:00:00.000Z"),
    });
    notes.create({
      videoId: OTHER_VIDEO_ID,
      body: "Other video",
      startSeconds: 5,
      createdAt: new Date("2000-01-04T00:00:00.000Z"),
    });

    expect(listVideoHighlights(VIDEO_ID).map((note) => note.id)).toEqual([early.id, late.id]);
    expect(listVideoHighlights(VIDEO_ID).map((note) => note.startSeconds)).toEqual([30, 200]);
  });

  it("returns an empty list when a video only has free-text notes", () => {
    notes.create({
      videoId: VIDEO_ID,
      body: "No timestamp",
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    expect(listVideoHighlights(VIDEO_ID)).toEqual([]);
  });

  it("rejects a malformed video id", () => {
    expect(() => listVideoHighlights("not-a-video-id")).toThrow(DomainValidationError);
  });
});
