// @vitest-environment node
/**
 * Upgrade-path tests for the entity-decode backfill (0005).
 *
 * The migration must decode rows that were written before the normalizers
 * learned to call `decodeHtmlEntities`, and it must leave user-authored text
 * alone. Each test therefore:
 *
 * 1. builds a temporary migration folder that stops at 0004,
 * 2. applies it with the real Drizzle migrator,
 * 3. seeds encoded, clean and user-entered values,
 * 4. applies the committed folder, which adds only 0005.
 *
 * That is exactly the path an existing `data/viewly.db` takes, and it proves
 * the backfill runs once on top of 0002-0004 without re-running any DDL. The
 * repository folder is never modified and `data/viewly.db` is never opened.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Absolute path of the committed migration folder. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

/** Tables that carry the denormalised YouTube display snapshot. */
const SNAPSHOT_TABLES = ["history", "favourites", "watch_later"] as const;

type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/** Index of the last migration written before the entity backfill. */
const PRE_BACKFILL_INDEX = 4;

/** Inserts a display-snapshot row into any of the three library tables. */
function insertSnapshot(
  sqlite: Database.Database,
  table: SnapshotTable,
  videoId: string,
  title: string,
  channelTitle: string,
): void {
  const timestampColumn = table === "history" ? "last_viewed_at" : "saved_at";
  const columns =
    table === "history"
      ? "video_id, title, channel_title, thumbnail_url, last_viewed_at, view_count"
      : `video_id, title, channel_title, thumbnail_url, duration_seconds, ${timestampColumn}`;
  sqlite
    .prepare(`insert into ${table} (${columns}) values (?, ?, ?, ?, ?, ?)`)
    .run(videoId, title, channelTitle, "https://example.com/thumb.jpg", 42, 1_700_000_000_000);
}

/**
 * Copies the journal and SQL files up to `lastIndex` into a throwaway folder.
 * The migrator reads only `meta/_journal.json` and the referenced `.sql` files,
 * so this is enough to stop the real migrator at 0004.
 */
function createPartialMigrationsFolder(lastIndex: number): string {
  const folder = mkdtempSync(join(tmpdir(), "viewly-entity-migrations-"));
  mkdirSync(join(folder, "meta"), { recursive: true });

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  const entries = journal.entries.slice(0, lastIndex + 1);

  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));

  for (const entry of entries) {
    copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }

  return folder;
}

let directory: string;
let partialFolder: string;
let sqlite: Database.Database;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "viewly-entity-decode-"));
  partialFolder = createPartialMigrationsFolder(PRE_BACKFILL_INDEX);
  sqlite = new Database(join(directory, "entity-decode.db"));

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  migrate(drizzle(sqlite), { migrationsFolder: partialFolder });
});

afterEach(() => {
  if (sqlite.open) {
    sqlite.close();
  }

  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  rmSync(partialFolder, { recursive: true, force: true, maxRetries: 3 });
});

/** Returns `{ title, channel_title }` for one seeded row. */
function readSnapshot(
  table: SnapshotTable,
  videoId: string,
): { title: string; channel_title: string } {
  return sqlite
    .prepare(`select title, channel_title from ${table} where video_id = ?`)
    .get(videoId) as { title: string; channel_title: string };
}

describe("entity decode backfill migration", () => {
  it("applies cleanly to an empty database", () => {
    const empty = new Database(":memory:");

    try {
      expect(() => migrate(drizzle(empty), { migrationsFolder: MIGRATIONS_FOLDER })).not.toThrow();
    } finally {
      empty.close();
    }
  });

  it("decodes every stored snapshot column exactly one level", () => {
    const encodedTitle = `Don&#39;t &quot;Panic&quot; &lt;Live&gt;&nbsp;Now &amp;amp; Then`;
    const decodedTitle = `Don't "Panic" <Live> Now &amp; Then`;
    const encodedChannel = "Tom &amp; Jerry";

    for (const table of SNAPSHOT_TABLES) {
      insertSnapshot(sqlite, table, "encoded", encodedTitle, encodedChannel);
    }

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

    for (const table of SNAPSHOT_TABLES) {
      expect(readSnapshot(table, "encoded")).toEqual({
        title: decodedTitle,
        channel_title: "Tom & Jerry",
      });
    }
  });

  it("decodes the hexadecimal apostrophe and leaves a literal ampersand alone", () => {
    for (const table of SNAPSHOT_TABLES) {
      insertSnapshot(sqlite, table, "hex", "Rock &#x27;n&#x27; Roll &amp; Me", "AT&T");
    }

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

    for (const table of SNAPSHOT_TABLES) {
      expect(readSnapshot(table, "hex")).toEqual({
        title: "Rock 'n' Roll & Me",
        channel_title: "AT&T",
      });
    }
  });

  it("leaves clean titles byte-identical", () => {
    // No entity in sight: a literal `&` must survive the backfill untouched.
    const cleanTitle = "Tom & Jerry";
    const cleanChannel = "AT&T & Friends";

    for (const table of SNAPSHOT_TABLES) {
      insertSnapshot(sqlite, table, "clean", cleanTitle, cleanChannel);
    }

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

    for (const table of SNAPSHOT_TABLES) {
      expect(readSnapshot(table, "clean")).toEqual({
        title: cleanTitle,
        channel_title: cleanChannel,
      });
    }
  });

  it("does not touch playlist names, playlist items or note bodies", () => {
    const userText = `Don&#39;t &amp; Me &amp;amp; Friends`;

    sqlite
      .prepare("insert into playlists (id, name, created_at, updated_at) values (?, ?, ?, ?)")
      .run("playlist-1", userText, 1_700_000_000_000, 1_700_000_000_000);
    sqlite
      .prepare(
        "insert into playlist_items (playlist_id, video_id, position, added_at) values (?, ?, ?, ?)",
      )
      .run("playlist-1", "video-a", 0, 1_700_000_000_000);
    sqlite
      .prepare(
        `insert into video_notes (id, video_id, body, start_seconds, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run("note-1", "video-a", userText, null, 1_700_000_000_000, 1_700_000_000_000);

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

    expect(sqlite.prepare("select name from playlists where id = ?").get("playlist-1")).toEqual({
      name: userText,
    });
    expect(sqlite.prepare("select body from video_notes where id = ?").get("note-1")).toEqual({
      body: userText,
    });
    // Playlist items have no snapshot columns; the backfill must not remove them.
    expect(
      sqlite.prepare("select count(*) as count from playlist_items").get() as { count: number },
    ).toEqual({ count: 1 });
  });

  it("records the backfill once so a second run changes nothing", () => {
    insertSnapshot(sqlite, "history", "encoded", "Don&#39;t Repeat", "Channel");

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
    expect(readSnapshot("history", "encoded").title).toBe("Don't Repeat");

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

    // Re-running the decoder would turn the still-encoded `&amp;` into `&`, so
    // this assertion proves the journal skipped the migration the second time.
    expect(readSnapshot("history", "encoded").title).toBe("Don't Repeat");
    expect(
      (
        sqlite.prepare("select count(*) as count from __drizzle_migrations").get() as {
          count: number;
        }
      ).count,
    ).toBe(6);
  });
});
