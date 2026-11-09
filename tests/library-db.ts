/**
 * Throwaway migrated SQLite database for library feature tests.
 *
 * Mirrors the setup in `src/lib/db/repositories/library.repository.test.ts`: a
 * fresh `mkdtemp` directory, the real migrations applied with the Drizzle
 * migrator, and the same pragmas `src/lib/db/client.ts` sets. `data/viewly.db`
 * is never opened and the sandbox is deleted by `dispose()`.
 *
 * Shared by the T33 action tests and the T39 integration suites. `path`,
 * `directory` and `sqlite` are exposed so integration tests can assert on raw
 * SQLite state (row counts, pragmas, cascade effects) without reaching into
 * module internals.
 *
 * The caller must mock `server-only` before importing this module, because the
 * repository factory imports it and Vitest is not a Server Component graph.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import type { ViewlyDatabase } from "@/lib/db/client";
import {
  createLibraryRepository,
  type LibraryRepository,
} from "@/lib/db/repositories/library.repository";

/** Absolute path of the committed migration folder. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

export interface TestLibraryDatabase {
  /** Drizzle client backed by the temporary file. */
  readonly db: ViewlyDatabase;
  /** Repository over the same client, for seeding and assertions. */
  readonly repository: LibraryRepository;
  /** Absolute path of the temporary SQLite file. */
  readonly path: string;
  /** `mkdtemp` directory that holds the file; removed by `dispose()`. */
  readonly directory: string;
  /** Raw handle, for pragmas, row counts and constraint assertions. */
  readonly sqlite: Database.Database;
  /** Closes the handle, then removes the directory (Windows cannot delete open files). */
  dispose(): void;
}

/** Creates an isolated, fully migrated library database. */
export function createTestLibraryDatabase(): TestLibraryDatabase {
  const directory = mkdtempSync(join(tmpdir(), "viewly-library-"));
  const path = join(directory, "library.db");
  const sqlite = new Database(path);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    repository: createLibraryRepository(db),
    path,
    directory,
    sqlite,
    dispose() {
      if (sqlite.open) {
        sqlite.close();
      }

      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
