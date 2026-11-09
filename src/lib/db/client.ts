/**
 * Server-only SQLite connection for Viewly, wrapped in Drizzle ORM.
 *
 * ## Why `server-only`
 *
 * `better-sqlite3` is a native Node.js addon and the database file lives on the
 * server's filesystem. Importing this module from a Client Component is a
 * build-time error, which keeps the connection (and its file path) out of the
 * browser bundle.
 *
 * ## Database location
 *
 * The file is resolved once per connection, in this order:
 *
 * 1. `DATABASE_PATH` from the environment. Next.js loads `.env.local`, `.env`
 *    and the process environment, so the shell wins over files, exactly as it
 *    does for every other variable.
 * 2. The default `data/viewly.db`, relative to the project root.
 *
 * Relative values are resolved against `process.cwd()`, which is the project
 * root for `next dev`, `next start` and npm scripts. The parent directory is
 * created recursively on first use, so a fresh clone needs no manual setup.
 * `data/`, `*.db`, `*.db-wal` and `*.db-shm` are git-ignored.
 *
 * ## Pragmas
 *
 * - `journal_mode = WAL`: readers never block the writer, which matters because
 *   Next.js renders several Server Components concurrently.
 * - `foreign_keys = ON`: SQLite parses but otherwise ignores `REFERENCES`
 *   clauses unless this is set per connection (better-sqlite3 does not compile
 *   with `SQLITE_DEFAULT_FOREIGN_KEYS`).
 *
 * ## Connections and hot reload
 *
 * A connection is a native handle plus an open file descriptor, so opening one
 * per call would exhaust handles. The connection is therefore a lazy singleton,
 * cached on `globalThis` outside production: `next dev` re-evaluates modules on
 * hot reload, and a module-local cache alone would leak a new connection on
 * every edit. The cache is lazy rather than created at import time so that
 * `next build` (which imports route modules without serving requests) never
 * creates a database file as a side effect.
 *
 * ## Cache Components
 *
 * `cacheComponents` is enabled in `next.config.ts`. `better-sqlite3` is a
 * synchronous API, so any query made while rendering must be wrapped in
 * `connection()` (or live behind a Suspense boundary) to opt the segment into
 * request-time rendering instead of prerendering. That wiring belongs to the
 * feature tickets; nothing here reads the clock or the render cache.
 */
import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";

/** Environment variable that overrides the database file location. */
export const DATABASE_PATH_ENV_VAR = "DATABASE_PATH";

/** Default database file, relative to the project root. */
export const DEFAULT_DATABASE_PATH = "data/viewly.db";

/** Drizzle client bound to the Viewly schema (currently empty; T11 adds tables). */
export type ViewlyDatabase = BetterSQLite3Database<typeof schema>;

/** The native handle and the Drizzle client that share one SQLite connection. */
export interface ViewlyDatabaseConnection {
  /** Drizzle client. Use this for queries. */
  readonly db: ViewlyDatabase;
  /** Underlying better-sqlite3 handle, for pragmas and maintenance scripts. */
  readonly sqlite: Database.Database;
  /** Absolute path of the open database file. */
  readonly path: string;
}

/**
 * Module-scoped cache. Cleared by {@link closeDatabaseConnection} and, in
 * development, backed up by the `globalThis` cache so hot reload reuses it.
 */
let cachedConnection: ViewlyDatabaseConnection | undefined;

/**
 * Cross-module cache for development hot reload. `globalThis` survives module
 * re-evaluation, so a reload does not open a second handle to the same file.
 */
const globalForDatabase = globalThis as typeof globalThis & {
  viewlyDatabaseConnection?: ViewlyDatabaseConnection;
};

/**
 * Absolute path of the SQLite file this process will use.
 *
 * Exported for diagnostics and tests; it performs no I/O and creates nothing.
 */
export function resolveDatabasePath(): string {
  const configured = (process.env[DATABASE_PATH_ENV_VAR] ?? "").trim();

  if (configured.length === 0) {
    // Literal segments keep this access statically scoped to `data/` for the
    // build's file tracer; a dynamic default would pull the whole project into
    // every server trace. This must stay `join(process.cwd(), "data", ...)`
    // rather than a variable so Turbopack can follow it.
    return join(process.cwd(), "data", "viewly.db");
  }

  return isAbsolute(configured)
    ? configured
    : // An override can point anywhere, so the tracer cannot scope it. Opt out
      // instead of letting it trace the entire project (the file is opened at
      // runtime, never bundled).
      resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/** Opens the database file and applies the connection pragmas. */
function createConnection(databasePath: string): ViewlyDatabaseConnection {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    path: databasePath,
  };
}

/**
 * Returns the process-wide connection, opening the database on first use.
 *
 * Repeated calls return the same object, so the native handle is never
 * duplicated. Anything that needs both the Drizzle client and the raw handle
 * (tests, maintenance scripts) should use this; ordinary queries should prefer
 * {@link getDb}.
 */
export function getDatabaseConnection(): ViewlyDatabaseConnection {
  const existing = cachedConnection ?? globalForDatabase.viewlyDatabaseConnection;

  if (existing !== undefined) {
    cachedConnection = existing;

    return existing;
  }

  const connection = createConnection(resolveDatabasePath());

  cachedConnection = connection;

  if (process.env.NODE_ENV !== "production") {
    globalForDatabase.viewlyDatabaseConnection = connection;
  }

  return connection;
}

/**
 * Typed Drizzle client for the Viewly database.
 *
 * ```ts
 * import { getDb } from "@/lib/db/client";
 *
 * const rows = await getDb().select().from(someTable);
 * ```
 */
export function getDb(): ViewlyDatabase {
  return getDatabaseConnection().db;
}

/**
 * Closes the cached connection and clears both caches.
 *
 * Intended for tests, one-off scripts and graceful shutdown. Safe to call when
 * no connection has been opened. The next `getDb()` call reopens the file.
 */
export function closeDatabaseConnection(): void {
  const existing = cachedConnection ?? globalForDatabase.viewlyDatabaseConnection;

  cachedConnection = undefined;
  delete globalForDatabase.viewlyDatabaseConnection;

  if (existing === undefined) {
    return;
  }

  if (existing.sqlite.open) {
    existing.sqlite.close();
  }
}
