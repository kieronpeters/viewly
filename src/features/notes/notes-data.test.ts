// @vitest-environment node
/**
 * Contract tests for the guarded watch-page notes read (T79 follow-up).
 *
 * A v0.1.0 database may not have `video_notes`. The page's read boundary must
 * report that as an authored state rather than throwing it into the route.
 */
import { describe, expect, it, vi } from "vitest";

const { dbHolder } = vi.hoisted(() => ({
  dbHolder: { db: undefined as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => dbHolder.db }));

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";
import { readVideoNotes } from "@/features/notes/notes-data";
import { createTestLibraryDatabase } from "../../../tests/library-db";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("readVideoNotes", () => {
  it("maps a missing table to the authored state instead of throwing", () => {
    const sqlite = new Database(":memory:");

    dbHolder.db = drizzle(sqlite, { schema });

    try {
      let result: ReturnType<typeof readVideoNotes> | undefined;

      expect(() => {
        result = readVideoNotes(VIDEO_ID);
      }).not.toThrow();

      expect(result).toEqual({ status: "database_needs_update" });
    } finally {
      sqlite.close();
    }
  });

  it("returns an ok read when the table exists but has no notes", () => {
    const library = createTestLibraryDatabase();

    dbHolder.db = library.db;

    try {
      expect(readVideoNotes(VIDEO_ID)).toEqual({ status: "ok", value: [] });
    } finally {
      library.dispose();
    }
  });
});
