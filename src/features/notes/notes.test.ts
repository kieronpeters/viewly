/**
 * Unit tests for the client-safe notes helpers (T90).
 *
 * These cover the two pieces a Server Action or the panel can call without a
 * database: timestamp validation and the split between free-text notes and
 * time-ordered highlights. The action and repository suites exercise the same
 * rules against a real migrated SQLite file.
 */
import { describe, expect, it } from "vitest";

import { parseNoteStartSeconds, partitionVideoNotes, type VideoNote } from "./notes";

const VIDEO_ID = "dQw4w9WgXcQ";

/** A note with only the fields the helpers inspect. */
function note(overrides: Partial<VideoNote> & Pick<VideoNote, "id">): VideoNote {
  return {
    videoId: VIDEO_ID,
    body: overrides.id,
    startSeconds: null,
    createdAt: "2026-11-10T12:00:00.000Z",
    updatedAt: "2026-11-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("parseNoteStartSeconds", () => {
  it("treats a missing timestamp as a free-text note", () => {
    expect(parseNoteStartSeconds(null)).toBeNull();
    expect(parseNoteStartSeconds(undefined)).toBeNull();
    expect(parseNoteStartSeconds(null, 213)).toBeNull();
  });

  it("accepts zero and the exact duration", () => {
    expect(parseNoteStartSeconds(0, 213)).toBe(0);
    expect(parseNoteStartSeconds(213, 213)).toBe(213);
  });

  it("floors fractional player positions", () => {
    expect(parseNoteStartSeconds(83.9, 213.9)).toBe(83);
  });

  it("skips the upper bound when the duration is unknown", () => {
    expect(parseNoteStartSeconds(9_000)).toBe(9_000);
    expect(parseNoteStartSeconds(9_000, 0)).toBe(9_000);
    expect(parseNoteStartSeconds(9_000, null)).toBe(9_000);
  });

  it("rejects a negative position", () => {
    expect(() => parseNoteStartSeconds(-1, 213)).toThrow(
      expect.objectContaining({ code: "out_of_range", field: "startSeconds" }),
    );
  });

  it("rejects a position past the duration", () => {
    expect(() => parseNoteStartSeconds(214, 213)).toThrow(
      expect.objectContaining({ code: "out_of_range", field: "startSeconds" }),
    );
  });

  it("rejects non-finite and non-numeric positions", () => {
    expect(() => parseNoteStartSeconds(Number.NaN, 213)).toThrow(
      expect.objectContaining({ code: "invalid_format", field: "startSeconds" }),
    );
    expect(() => parseNoteStartSeconds(Number.POSITIVE_INFINITY, 213)).toThrow(
      expect.objectContaining({ code: "invalid_format", field: "startSeconds" }),
    );
    expect(() => parseNoteStartSeconds("83", 213)).toThrow(
      expect.objectContaining({ code: "invalid_type", field: "startSeconds" }),
    );
  });

  it("rejects a non-finite duration instead of silently accepting it", () => {
    expect(() => parseNoteStartSeconds(83, Number.NaN)).toThrow(
      expect.objectContaining({ code: "invalid_format", field: "durationSeconds" }),
    );
    expect(() => parseNoteStartSeconds(83, "213")).toThrow(
      expect.objectContaining({ code: "invalid_format", field: "durationSeconds" }),
    );
  });
});

describe("partitionVideoNotes", () => {
  it("keeps free-text notes in the repository's newest-first order", () => {
    const newer = note({ id: "note-newer", createdAt: "2026-11-10T13:00:00.000Z" });
    const older = note({ id: "note-older", createdAt: "2026-11-09T13:00:00.000Z" });

    expect(partitionVideoNotes([newer, older]).notes.map((item) => item.id)).toEqual([
      "note-newer",
      "note-older",
    ]);
  });

  it("orders highlights by playback time, not creation time", () => {
    const late = note({
      id: "late",
      startSeconds: 200,
      createdAt: "2026-11-10T13:00:00.000Z",
    });
    const early = note({
      id: "early",
      startSeconds: 30,
      createdAt: "2026-11-10T14:00:00.000Z",
    });

    const { highlights } = partitionVideoNotes([late, early]);

    expect(highlights.map((item) => item.id)).toEqual(["early", "late"]);
  });

  it("breaks ties by creation time and then id", () => {
    const second = note({
      id: "b",
      startSeconds: 30,
      createdAt: "2026-11-10T13:00:01.000Z",
    });
    const first = note({
      id: "a",
      startSeconds: 30,
      createdAt: "2026-11-10T13:00:00.000Z",
    });
    const sameTime = note({
      id: "c",
      startSeconds: 30,
      createdAt: "2026-11-10T13:00:00.000Z",
    });

    const { highlights } = partitionVideoNotes([second, sameTime, first]);

    expect(highlights.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("separates the two lists and does not mutate the input", () => {
    const freeText = note({ id: "free" });
    const highlight = note({ id: "highlight", startSeconds: 83 });
    const input = [highlight, freeText];

    const result = partitionVideoNotes(input);

    expect(result.notes.map((item) => item.id)).toEqual(["free"]);
    expect(result.highlights.map((item) => item.id)).toEqual(["highlight"]);
    expect(input.map((item) => item.id)).toEqual(["highlight", "free"]);
  });
});
