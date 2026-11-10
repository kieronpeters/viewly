// @vitest-environment node
/**
 * Tests for the notes query layer (T79, extended by T90).
 *
 * Every test opens a throwaway SQLite file in a fresh `mkdtemp` directory,
 * applies the committed migrations with the real Drizzle migrator, and hands
 * that client to `createNotesRepository`. `data/viewly.db` is never opened and
 * the sandbox is deleted after each test.
 *
 * The repository imports `server-only`, which throws outside a Server Component
 * graph; Vitest is not one, so the package is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createNotesRepository,
  type NotesRepository,
} from "@/lib/db/repositories/notes.repository";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../../tests/library-db";

const VIDEO_ID = "dQw4w9WgXcQ";
const OTHER_VIDEO_ID = "9bZkp7q19f0";

let library: TestLibraryDatabase;
let notes: NotesRepository;

beforeEach(() => {
  library = createTestLibraryDatabase();
  notes = createNotesRepository(library.db);
});

afterEach(() => {
  library.dispose();
});

/** A deterministic UTC timestamp for a day in 2000. */
function day(dayNumber: number): Date {
  return new Date(Date.UTC(2000, 0, dayNumber));
}

describe("notes repository", () => {
  it("stores a free-text note with a null timestamp", () => {
    const created = notes.create({ videoId: VIDEO_ID, body: "Plain note", createdAt: day(1) });

    expect(created.startSeconds).toBeNull();
    expect(notes.get(created.id)?.startSeconds).toBeNull();
  });

  it("stores an explicit null timestamp", () => {
    const created = notes.create({
      videoId: VIDEO_ID,
      body: "Plain note",
      startSeconds: null,
      createdAt: day(1),
    });

    expect(created.startSeconds).toBeNull();
  });

  it("stores a highlight's whole-second position", () => {
    const created = notes.create({
      videoId: VIDEO_ID,
      body: "Highlight",
      startSeconds: 83,
      createdAt: day(1),
    });

    expect(created.startSeconds).toBe(83);
    expect(notes.get(created.id)?.startSeconds).toBe(83);
  });

  it("rejects a negative timestamp at the storage layer", () => {
    expect(() =>
      library.sqlite
        .prepare(
          `insert into video_notes (id, video_id, body, start_seconds, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?)`,
        )
        .run("raw-negative", VIDEO_ID, "Body", -1, day(1).getTime(), day(1).getTime()),
    ).toThrow(/CHECK constraint failed: video_notes_start_seconds_non_negative/);
  });

  it("lists every note for one video newest first, including highlights", () => {
    const first = notes.create({ videoId: VIDEO_ID, body: "First", createdAt: day(1) });
    const second = notes.create({
      videoId: VIDEO_ID,
      body: "Second",
      startSeconds: 30,
      createdAt: day(2),
    });
    const third = notes.create({
      videoId: VIDEO_ID,
      body: "Third",
      startSeconds: 90,
      createdAt: day(3),
    });
    notes.create({ videoId: OTHER_VIDEO_ID, body: "Other", createdAt: day(4) });

    expect(notes.listForVideo(VIDEO_ID).map((row) => row.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(notes.listForVideo(VIDEO_ID).map((row) => row.startSeconds)).toEqual([90, 30, null]);
  });

  it("lists highlights in playback order and excludes free-text notes", () => {
    const late = notes.create({
      videoId: VIDEO_ID,
      body: "Late",
      startSeconds: 200,
      createdAt: day(1),
    });
    const early = notes.create({
      videoId: VIDEO_ID,
      body: "Early",
      startSeconds: 30,
      createdAt: day(2),
    });
    notes.create({
      videoId: VIDEO_ID,
      body: "Free text",
      createdAt: day(3),
    });
    notes.create({
      videoId: OTHER_VIDEO_ID,
      body: "Other video",
      startSeconds: 5,
      createdAt: day(4),
    });

    expect(notes.listHighlightsForVideo(VIDEO_ID).map((row) => row.id)).toEqual([
      early.id,
      late.id,
    ]);
  });

  it("orders highlights on the same second by creation time and then id", () => {
    notes.create({
      id: "highlight-b",
      videoId: VIDEO_ID,
      body: "B",
      startSeconds: 30,
      createdAt: new Date("2000-01-01T00:00:01.000Z"),
    });
    notes.create({
      id: "highlight-a",
      videoId: VIDEO_ID,
      body: "A",
      startSeconds: 30,
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    notes.create({
      id: "highlight-c",
      videoId: VIDEO_ID,
      body: "C",
      startSeconds: 30,
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    expect(notes.listHighlightsForVideo(VIDEO_ID).map((row) => row.id)).toEqual([
      "highlight-a",
      "highlight-c",
      "highlight-b",
    ]);
  });

  it("keeps the timestamp when only the body is updated", () => {
    const created = notes.create({
      videoId: VIDEO_ID,
      body: "Before",
      startSeconds: 83,
      createdAt: day(1),
    });

    const updated = notes.update(created.id, "After", day(2));

    expect(updated).toMatchObject({ id: created.id, body: "After", startSeconds: 83 });
    expect(updated?.createdAt).toEqual(day(1));
    expect(updated?.updatedAt).toEqual(day(2));
  });

  it("deletes a highlight without touching the other notes", () => {
    const highlight = notes.create({
      videoId: VIDEO_ID,
      body: "Remove",
      startSeconds: 83,
      createdAt: day(1),
    });
    const keeper = notes.create({ videoId: VIDEO_ID, body: "Keep", createdAt: day(2) });

    expect(notes.delete(highlight.id)).toBe(true);
    expect(notes.delete(highlight.id)).toBe(false);
    expect(notes.get(highlight.id)).toBeUndefined();
    expect(notes.get(keeper.id)).toBeDefined();
    expect(notes.listHighlightsForVideo(VIDEO_ID)).toEqual([]);
  });
});
