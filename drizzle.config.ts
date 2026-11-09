/**
 * Drizzle Kit configuration for the Viewly SQLite database.
 *
 * Used by the `db:generate`, `db:migrate` and `db:studio` package scripts and by
 * any direct `npx drizzle-kit ...` invocation. Run them from the project root:
 * the paths below are resolved against `process.cwd()`, which is the project
 * root for npm scripts.
 *
 * ## Database location
 *
 * `dbCredentials.url` resolves in this order (highest precedence first):
 *
 * 1. `DATABASE_PATH` already present in the process environment, for example
 *    `DATABASE_PATH=./tmp/x.db npm run db:migrate`. Shell values always win and
 *    are never overwritten by this file.
 * 2. `DATABASE_PATH` from `.env.local` (Next.js' local override, git-ignored),
 *    loaded here because Drizzle Kit only reads `.env` on its own.
 * 3. `DATABASE_PATH` from `.env` (git-ignored; Drizzle Kit loads it before this
 *    config runs).
 * 4. The default `data/viewly.db` relative to the project root — the same
 *    default as `src/lib/db/client.ts`, so the CLI and the running app always
 *    point at the same file when nothing is configured.
 *
 * Relative values are resolved against the project root. `.env.local` is only
 * read when the running Node.js version provides `process.loadEnvFile`
 * (Node.js >= 20.12); Drizzle Kit itself needs Node.js >= 22 for
 * `better-sqlite3` v13, so in practice it is always available.
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { defineConfig } from "drizzle-kit";

/** Environment variable that overrides the database file location. */
const DATABASE_PATH_ENV_VAR = "DATABASE_PATH";

/** Default database file, relative to the project root. */
const DEFAULT_DATABASE_PATH = "data/viewly.db";

/**
 * Loads a git-ignored dotenv file without clobbering variables that are already
 * set, matching how Next.js merges `.env*` files (the shell wins).
 */
function loadEnvFileIfPresent(fileName: string): void {
  const filePath = resolve(process.cwd(), fileName);

  if (!existsSync(filePath) || typeof process.loadEnvFile !== "function") {
    return;
  }

  try {
    process.loadEnvFile(filePath);
  } catch {
    // A malformed or unreadable file must not break the CLI; the default below
    // still applies and the app surfaces configuration problems at runtime.
  }
}

/** Resolves the absolute SQLite file path used by both Drizzle Kit and the app. */
function resolveDatabaseUrl(): string {
  // `.env.local` takes precedence over `.env`, which Drizzle Kit has already loaded.
  loadEnvFileIfPresent(".env.local");

  const configured = (process.env[DATABASE_PATH_ENV_VAR] ?? "").trim();

  if (configured.length === 0) {
    return resolve(process.cwd(), DEFAULT_DATABASE_PATH);
  }

  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
  strict: true,
  verbose: true,
});
