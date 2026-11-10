// @vitest-environment node
/**
 * Contract tests for the guarded watch-page progress read (T70/T68 follow-up).
 *
 * A database that predates the progress migration must not throw a raw SQLite
 * 500 into the route. These tests use a real `better-sqlite3` handle: one with
 * no tables at all (the v0.1.0 symptom) and one fully migrated by the shared
 * test helper.
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
import { readVideoProgress } from "@/features/progress/progress-data";
import { createProgressRepository } from "@/lib/db/repositories/progress.repository";
import { createTestLibraryDatabase } from "../../../tests/library-db";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("readVideoProgress", () => {
  it("maps a missing table to the authored state instead of throwing", () => {
    const sqlite = new Database(":memory:");

    dbHolder.db = drizzle(sqlite, { schema });

    try {
      let result: ReturnType<typeof readVideoProgress> | undefined;

      expect(() => {
        result = readVideoProgress(VIDEO_ID);
      }).not.toThrow();

      expect(result).toEqual({ status: "database_needs_update" });
    } finally {
      sqlite.close();
    }
  });

  it("returns an ok read when the table exists but has no row", () => {
    const library = createTestLibraryDatabase();

    dbHolder.db = library.db;

    try {
      expect(readVideoProgress(VIDEO_ID)).toEqual({ status: "ok", value: null });
    } finally {
      library.dispose();
    }
  });

  it("returns stored progress through the ok status", () => {
    const library = createTestLibraryDatabase();

    dbHolder.db = library.db;

    try {
      createProgressRepository(library.db).save({
        videoId: VIDEO_ID,
        positionSeconds: 42,
        durationSeconds: 200,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const result = readVideoProgress(VIDEO_ID);

      expect(result.status).toBe("ok");
      expect(result.status === "ok" ? result.value?.positionSeconds : undefined).toBe(42);
    } finally {
      library.dispose();
    }
  });
});
