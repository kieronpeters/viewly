// @vitest-environment node
/**
 * Tests for the server-only SQLite client.
 *
 * Every test points `DATABASE_PATH` at a fresh directory under the OS temp
 * directory, so the developer's `data/viewly.db` is never created, opened or
 * modified. The sandbox is removed in `afterEach`; the connection is closed
 * first because Windows refuses to delete files that are still open.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));

const ORIGINAL_DATABASE_PATH = process.env.DATABASE_PATH;

let sandboxDirectory: string;
let databasePath: string;

/** Imports the client module fresh, so each test starts without a connection. */
async function loadClient(): Promise<typeof import("@/lib/db/client")> {
  return import("@/lib/db/client");
}

beforeEach(() => {
  vi.resetModules();

  sandboxDirectory = mkdtempSync(join(tmpdir(), "viewly-db-"));
  // A nested, not-yet-existing parent directory proves the recursive mkdir.
  databasePath = join(sandboxDirectory, "nested", "sqlite", "viewly-test.db");
  process.env.DATABASE_PATH = databasePath;
});

afterEach(async () => {
  const client = await loadClient();

  client.closeDatabaseConnection();

  if (ORIGINAL_DATABASE_PATH === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = ORIGINAL_DATABASE_PATH;
  }

  rmSync(sandboxDirectory, { recursive: true, force: true });
});

describe("getDatabaseConnection", () => {
  it("creates the database file, including missing parent directories, and runs SELECT 1", async () => {
    const client = await loadClient();

    expect(existsSync(dirname(databasePath))).toBe(false);

    const connection = client.getDatabaseConnection();

    expect(existsSync(databasePath)).toBe(true);
    expect(connection.path).toBe(resolve(databasePath));

    // Parameter-free statement: no user input reaches SQL here.
    const row = connection.sqlite.prepare("SELECT 1 AS value").get();

    expect(row).toEqual({ value: 1 });
  });

  it("enables WAL journaling and foreign key enforcement", async () => {
    const client = await loadClient();
    const connection = client.getDatabaseConnection();

    const journalMode = String(connection.sqlite.pragma("journal_mode", { simple: true }));
    const foreignKeys = Number(connection.sqlite.pragma("foreign_keys", { simple: true }));

    expect(journalMode).toBe("wal");
    expect(foreignKeys).toBe(1);
  });

  it("reuses one connection when hot reload re-evaluates the module", async () => {
    const firstClient = await loadClient();
    const firstConnection = firstClient.getDatabaseConnection();

    // Simulates `next dev` reloading the module graph: the module is
    // re-evaluated, but the `globalThis` cache must survive.
    vi.resetModules();

    const secondClient = await loadClient();
    const secondConnection = secondClient.getDatabaseConnection();

    expect(secondConnection).toBe(firstConnection);
    expect(secondConnection.db).toBe(firstConnection.db);
    expect(secondConnection.sqlite).toBe(firstConnection.sqlite);
    expect(firstConnection.sqlite.open).toBe(true);
  });

  it("resolves the default path under the project root when DATABASE_PATH is unset", async () => {
    delete process.env.DATABASE_PATH;

    const client = await loadClient();
    const resolvedPath = client.resolveDatabasePath();

    expect(resolvedPath).toBe(resolve(process.cwd(), "data", "viewly.db"));
    expect(resolvedPath.endsWith(`${sep}data${sep}viewly.db`)).toBe(true);
    // Resolving must not create anything.
    expect(existsSync(resolvedPath)).toBe(false);
  });

  it("resolves a relative DATABASE_PATH against the project root", async () => {
    process.env.DATABASE_PATH = `  ${join("tmp", "relative-viewly.db")}  `;

    const client = await loadClient();

    expect(client.resolveDatabasePath()).toBe(resolve(process.cwd(), "tmp", "relative-viewly.db"));
  });
});

describe("getDb", () => {
  it("exposes the same Drizzle client as the connection object", async () => {
    const client = await loadClient();

    const connection = client.getDatabaseConnection();

    expect(client.getDb()).toBe(connection.db);
  });
});

describe("closeDatabaseConnection", () => {
  it("closes the handle, clears the cache and reopens on the next call", async () => {
    const client = await loadClient();
    const firstConnection = client.getDatabaseConnection();

    client.closeDatabaseConnection();

    expect(firstConnection.sqlite.open).toBe(false);

    const secondConnection = client.getDatabaseConnection();

    expect(secondConnection).not.toBe(firstConnection);
    expect(secondConnection.sqlite.open).toBe(true);
    expect(Number(secondConnection.sqlite.pragma("foreign_keys", { simple: true }))).toBe(1);
  });
});
