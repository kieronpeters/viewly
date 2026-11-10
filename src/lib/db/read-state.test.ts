import { describe, expect, it, vi } from "vitest";

import {
  DATABASE_NEEDS_UPDATE,
  isMissingTableError,
  readDatabase,
  type DatabaseRead,
} from "./read-state";

/** A failure shaped like `better-sqlite3`'s missing-table `SqliteError`. */
function missingTable(table = "video_progress"): Error {
  return Object.assign(new Error(`no such table: ${table}`), { code: "SQLITE_ERROR" });
}

describe("isMissingTableError", () => {
  it("recognises the SQLite missing-table failure", () => {
    expect(isMissingTableError(missingTable())).toBe(true);
    expect(isMissingTableError(missingTable("video_notes"))).toBe(true);
    // Case-insensitive because SQLite's message casing is not part of the API.
    expect(isMissingTableError(new Error("NO SUCH TABLE: video_progress"))).toBe(true);
  });

  it("does not treat other failures as a missing table", () => {
    expect(isMissingTableError(new Error("disk I/O error"))).toBe(false);
    expect(
      isMissingTableError(
        Object.assign(new Error("no such column: x"), {
          code: "SQLITE_ERROR",
        }),
      ),
    ).toBe(false);
    expect(isMissingTableError(Object.assign(missingTable(), { code: "SQLITE_CONSTRAINT" }))).toBe(
      false,
    );
    expect(isMissingTableError("no such table: video_progress")).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});

describe("readDatabase", () => {
  it("returns a successful read unchanged", () => {
    expect(readDatabase(() => 42)).toEqual({ status: "ok", value: 42 });
  });

  it("maps a missing table to the authored status", () => {
    const result: DatabaseRead<number> = readDatabase(() => {
      throw missingTable();
    });

    expect(result).toEqual({ status: DATABASE_NEEDS_UPDATE });
  });

  it("rethrows any other failure", () => {
    const failure = new Error("disk I/O error");
    const read = vi.fn(() => {
      throw failure;
    });

    expect(() => readDatabase(read)).toThrow(failure);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
