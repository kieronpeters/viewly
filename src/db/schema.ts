/**
 * Drizzle schema for the Viewly SQLite database.
 *
 * Intentionally empty for now: T10 wires up SQLite, Drizzle Kit and the
 * server-only client so that the schema/migration pipeline can be exercised
 * end to end. The library tables are owned by T11 and must be added here.
 *
 * ## What T11 should do
 *
 * - Declare tables with `sqliteTable` from `drizzle-orm/sqlite-core` and export
 *   each one by name; Drizzle Kit discovers tables from this file's exports.
 * - Add `references(...)` for foreign keys. The client enables
 *   `PRAGMA foreign_keys = ON` on every connection, so SQLite enforces them.
 * - Add explicit indexes for the columns the app filters and orders by.
 * - Run `npm run db:generate` to emit SQL into `src/db/migrations` and commit
 *   the generated files with the schema change.
 *
 * ## Conventions
 *
 * - Timestamps are stored as UTC milliseconds (`integer` with
 *   `{ mode: "timestamp_ms" }`) or ISO-8601 text, never SQLite's local-time
 *   `DATETIME` defaults.
 * - Booleans are stored as `integer` with `{ mode: "boolean" }`.
 * - SQLite has no ALTER-heavy migration support; prefer additive migrations.
 *
 * The module has one statement (`export {}`) so it is a valid ES module and
 * Drizzle Kit can load it even while there are no tables.
 */
export {};
