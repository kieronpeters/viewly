/**
 * Query layer for the personal video library: favourites, watch later, history,
 * playlists and playlist items.
 *
 * ## Shape
 *
 * The module exports a factory, {@link createLibraryRepository}, rather than a
 * process-wide singleton. Callers pass the Drizzle client they already have:
 *
 * ```ts
 * import { getDb } from "@/lib/db/client";
 * import { createLibraryRepository } from "@/lib/db/repositories/library.repository";
 *
 * export const library = createLibraryRepository(getDb());
 * ```
 *
 * Tests build their own client against a migrated temporary file and never
 * touch `data/viewly.db`. No module in this file imports the connection
 * singleton, so importing it has no I/O side effect.
 *
 * ## Synchronous results
 *
 * `better-sqlite3` is a synchronous driver, so every function materialises its
 * query with `.all()` / `.get()` and returns the value directly. Callers may
 * still `await` the result (awaiting a non-promise is a no-op), which keeps the
 * query layer usable from async Server Components without pretending the
 * driver is asynchronous.
 *
 * ## Time and ids
 *
 * Nothing here reads the wall clock. Every function that needs a timestamp
 * takes it as a `Date` from the caller (`savedAt`, `viewedAt`, `createdAt`,
 * `updatedAt`, `addedAt`), so tests and future features control ordering
 * exactly. The one exception is playlist id generation, which is not a clock
 * read: `createPlaylist` accepts a caller-supplied id and otherwise generates
 * one with `crypto.randomUUID()`, matching the schema's note that playlist ids
 * are application-generated.
 *
 * ## Idempotency
 *
 * Saves are `INSERT ... ON CONFLICT DO NOTHING`, so a duplicated favourite,
 * watch-later entry or playlist item is a no-op and returns the row that was
 * already stored. `recordView` is `INSERT ... ON CONFLICT DO UPDATE`: it bumps
 * `view_count` and `last_viewed_at` and refreshes the display snapshot on the
 * single row for that video. Deletes report whether they removed anything, so
 * repeating them is safe.
 *
 * ## Ordering
 *
 * Lists are newest-first where the schema has a "saved/last viewed" timestamp
 * and follow `position` inside a playlist. Positions are append-only: removing
 * an item leaves a gap rather than renumbering its neighbours, because the
 * schema treats `position` as a mutable ordering value rather than a dense
 * index. A future reorder feature can rewrite positions in one transaction.
 *
 * ## Cascade
 *
 * Deleting a playlist relies on the schema's `ON DELETE CASCADE` for
 * `playlist_items`. That only works when the connection has
 * `PRAGMA foreign_keys = ON`, which `src/lib/db/client.ts` sets for the app;
 * any other connection (tests, scripts) must set it too. This module does not
 * delete items by hand.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, getTableColumns, max, sql } from "drizzle-orm";

import { favourites, history, playlistItems, playlists, watchLater } from "@/db/schema";
import type { ViewlyDatabase } from "@/lib/db/client";

/** A row of `favourites`, with `savedAt` as a `Date`. */
export type FavouriteRow = typeof favourites.$inferSelect;

/** A row of `watch_later`, with `savedAt` as a `Date`. */
export type WatchLaterRow = typeof watchLater.$inferSelect;

/** A row of `history`, with `lastViewedAt` as a `Date`. */
export type HistoryRow = typeof history.$inferSelect;

/** A row of `playlists`, with `createdAt` / `updatedAt` as `Date`s. */
export type PlaylistRow = typeof playlists.$inferSelect;

/** A row of `playlist_items`, with `addedAt` as a `Date`. */
export type PlaylistItemRow = typeof playlistItems.$inferSelect;

/**
 * The display snapshot shared by favourites, watch later and history.
 *
 * Derived from the schema so a new column only has to be added in
 * `src/db/schema.ts`.
 */
export type VideoSnapshot = Pick<
  FavouriteRow,
  "videoId" | "title" | "channelTitle" | "thumbnailUrl" | "durationSeconds"
>;

/** Input for {@link LibraryRepository.favourites.add} and `.watchLater.add`. */
export interface SaveVideoInput extends VideoSnapshot {
  /** When the user saved the video, UTC milliseconds. */
  savedAt: Date;
}

/** Input for {@link LibraryRepository.history.recordView}. */
export interface RecordViewInput extends VideoSnapshot {
  /** When the view happened, UTC milliseconds. */
  viewedAt: Date;
}

/** Input for {@link LibraryRepository.playlists.create}. */
export interface CreatePlaylistInput {
  /** User-visible name. May duplicate another playlist's name. */
  name: string;
  /** Creation time, UTC milliseconds. */
  createdAt: Date;
  /** Initial modification time, UTC milliseconds (usually `createdAt`). */
  updatedAt: Date;
  /**
   * Caller-supplied id, for example when restoring a backup. Generated with
   * `crypto.randomUUID()` when omitted.
   */
  id?: string;
}

/** Input for {@link LibraryRepository.playlistItems.add}. */
export interface AddPlaylistItemInput {
  /** Existing playlist; a foreign-key error is thrown if it does not exist. */
  playlistId: string;
  /** YouTube video id. */
  videoId: string;
  /** When the video was added, UTC milliseconds. */
  addedAt: Date;
}

/** A playlist plus the number of videos inside it. */
export type PlaylistWithItemCount = PlaylistRow & { itemCount: number };

/** A playlist plus its items, ordered by `position` ascending. */
export type PlaylistWithItems = PlaylistRow & { items: PlaylistItemRow[] };

/** Typed query surface for the library tables. */
export interface LibraryRepository {
  readonly favourites: {
    /** Saves a video; a duplicate is a no-op that returns the stored row. */
    add(input: SaveVideoInput): FavouriteRow;
    /** Removes a video. Returns `true` when a row was deleted. */
    remove(videoId: string): boolean;
    /** Every favourite, most recently saved first. */
    list(): FavouriteRow[];
    /** Whether the video is currently a favourite. */
    isFavourite(videoId: string): boolean;
  };
  readonly watchLater: {
    /** Queues a video; a duplicate is a no-op that returns the stored row. */
    add(input: SaveVideoInput): WatchLaterRow;
    /** Removes a queued video. Returns `true` when a row was deleted. */
    remove(videoId: string): boolean;
    /** The whole queue, most recently added first. */
    list(): WatchLaterRow[];
    /** Whether the video is currently in the watch-later queue. */
    isInWatchLater(videoId: string): boolean;
  };
  readonly history: {
    /**
     * Records one view: inserts the first row for a video, or bumps
     * `viewCount` and `lastViewedAt` and refreshes the snapshot on repeat views.
     */
    recordView(input: RecordViewInput): HistoryRow;
    /** Every watched video, most recently viewed first. */
    list(): HistoryRow[];
    /** Removes one video's history entry. Returns `true` when a row was deleted. */
    clearOne(videoId: string): boolean;
    /** Empties the history table. Returns the number of deleted rows. */
    clearAll(): number;
  };
  readonly playlists: {
    /** Creates a playlist, generating its id when none is supplied. */
    create(input: CreatePlaylistInput): PlaylistRow;
    /**
     * Renames a playlist and records `updatedAt`.
     * Returns the updated row, or `undefined` when the playlist does not exist.
     */
    rename(id: string, name: string, updatedAt: Date): PlaylistRow | undefined;
    /**
     * Deletes a playlist. Its items are removed by the schema's
     * `ON DELETE CASCADE`. Returns `true` when a row was deleted.
     */
    delete(id: string): boolean;
    /** Every playlist with its item count, most recently modified first. */
    list(): PlaylistWithItemCount[];
    /** One playlist with its items ordered by position, or `undefined`. */
    get(id: string): PlaylistWithItems | undefined;
  };
  readonly playlistItems: {
    /**
     * Appends a video to the end of a playlist. Adding the same video twice is
     * a no-op that returns the existing row.
     */
    add(input: AddPlaylistItemInput): PlaylistItemRow;
    /** Removes a video from a playlist. Returns `true` when a row was deleted. */
    remove(playlistId: string, videoId: string): boolean;
    /** A playlist's items, ordered by position ascending. */
    list(playlistId: string): PlaylistItemRow[];
  };
}

/**
 * Builds the typed library query surface over an existing Drizzle client.
 *
 * The client is captured once, so constructing the repository is cheap and can
 * happen per request (or per test) without opening a connection.
 */
export function createLibraryRepository(db: ViewlyDatabase): LibraryRepository {
  return {
    favourites: {
      add(input) {
        const inserted = db
          .insert(favourites)
          .values({ ...input })
          .onConflictDoNothing({ target: favourites.videoId })
          .returning()
          .get();

        if (inserted !== undefined) {
          return inserted;
        }

        // The conflict was a duplicate save: return the row that won. The video
        // id is the primary key, so the row must exist unless it was deleted
        // between the two statements (impossible with the synchronous driver).
        const existing = db
          .select()
          .from(favourites)
          .where(eq(favourites.videoId, input.videoId))
          .get();

        if (existing === undefined) {
          throw new Error(`Favourite ${input.videoId} disappeared during an idempotent save.`);
        }

        return existing;
      },
      remove(videoId) {
        return db.delete(favourites).where(eq(favourites.videoId, videoId)).run().changes > 0;
      },
      list() {
        return db.select().from(favourites).orderBy(desc(favourites.savedAt)).all();
      },
      isFavourite(videoId) {
        const row = db
          .select({ videoId: favourites.videoId })
          .from(favourites)
          .where(eq(favourites.videoId, videoId))
          .limit(1)
          .get();

        return row !== undefined;
      },
    },

    watchLater: {
      add(input) {
        const inserted = db
          .insert(watchLater)
          .values({ ...input })
          .onConflictDoNothing({ target: watchLater.videoId })
          .returning()
          .get();

        if (inserted !== undefined) {
          return inserted;
        }

        const existing = db
          .select()
          .from(watchLater)
          .where(eq(watchLater.videoId, input.videoId))
          .get();

        if (existing === undefined) {
          throw new Error(
            `Watch-later entry ${input.videoId} disappeared during an idempotent save.`,
          );
        }

        return existing;
      },
      remove(videoId) {
        return db.delete(watchLater).where(eq(watchLater.videoId, videoId)).run().changes > 0;
      },
      list() {
        return db.select().from(watchLater).orderBy(desc(watchLater.savedAt)).all();
      },
      isInWatchLater(videoId) {
        const row = db
          .select({ videoId: watchLater.videoId })
          .from(watchLater)
          .where(eq(watchLater.videoId, videoId))
          .limit(1)
          .get();

        return row !== undefined;
      },
    },

    history: {
      recordView(input) {
        const row = db
          .insert(history)
          .values({
            videoId: input.videoId,
            title: input.title,
            channelTitle: input.channelTitle,
            thumbnailUrl: input.thumbnailUrl,
            durationSeconds: input.durationSeconds,
            lastViewedAt: input.viewedAt,
            viewCount: 1,
          })
          .onConflictDoUpdate({
            target: history.videoId,
            set: {
              title: input.title,
              channelTitle: input.channelTitle,
              thumbnailUrl: input.thumbnailUrl,
              durationSeconds: input.durationSeconds,
              lastViewedAt: input.viewedAt,
              // Increment in SQL rather than reading-then-writing, so the
              // counter cannot lose an update.
              viewCount: sql`${history.viewCount} + 1`,
            },
          })
          .returning()
          .get();

        if (row === undefined) {
          throw new Error(`History row ${input.videoId} was not returned by the upsert.`);
        }

        return row;
      },
      list() {
        return db.select().from(history).orderBy(desc(history.lastViewedAt)).all();
      },
      clearOne(videoId) {
        return db.delete(history).where(eq(history.videoId, videoId)).run().changes > 0;
      },
      clearAll() {
        return db.delete(history).run().changes;
      },
    },

    playlists: {
      create(input) {
        return db
          .insert(playlists)
          .values({
            id: input.id ?? randomUUID(),
            name: input.name,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          })
          .returning()
          .get();
      },
      rename(id, name, updatedAt) {
        return db
          .update(playlists)
          .set({ name, updatedAt })
          .where(eq(playlists.id, id))
          .returning()
          .get();
      },
      delete(id) {
        return db.delete(playlists).where(eq(playlists.id, id)).run().changes > 0;
      },
      list() {
        return db
          .select({
            ...getTableColumns(playlists),
            itemCount: count(playlistItems.videoId),
          })
          .from(playlists)
          .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
          .groupBy(playlists.id)
          .orderBy(desc(playlists.updatedAt), asc(playlists.id))
          .all();
      },
      get(id) {
        const playlist = db.select().from(playlists).where(eq(playlists.id, id)).get();

        if (playlist === undefined) {
          return undefined;
        }

        const items = db
          .select()
          .from(playlistItems)
          .where(eq(playlistItems.playlistId, id))
          .orderBy(asc(playlistItems.position), asc(playlistItems.videoId))
          .all();

        return { ...playlist, items };
      },
    },

    playlistItems: {
      add(input) {
        // Append at the end. Positions are not compacted, so the current
        // maximum is the only fact needed; `max` returns null on an empty
        // playlist. The synchronous driver means the read and the insert
        // cannot interleave with another write on this connection.
        const highest = db
          .select({ position: max(playlistItems.position) })
          .from(playlistItems)
          .where(eq(playlistItems.playlistId, input.playlistId))
          .get();

        const position = (highest?.position ?? -1) + 1;

        const inserted = db
          .insert(playlistItems)
          .values({
            playlistId: input.playlistId,
            videoId: input.videoId,
            position,
            addedAt: input.addedAt,
          })
          .onConflictDoNothing({
            target: [playlistItems.playlistId, playlistItems.videoId],
          })
          .returning()
          .get();

        if (inserted !== undefined) {
          return inserted;
        }

        const existing = db
          .select()
          .from(playlistItems)
          .where(
            and(
              eq(playlistItems.playlistId, input.playlistId),
              eq(playlistItems.videoId, input.videoId),
            ),
          )
          .get();

        if (existing === undefined) {
          throw new Error(
            `Playlist item ${input.playlistId}/${input.videoId} disappeared during an idempotent add.`,
          );
        }

        return existing;
      },
      remove(playlistId, videoId) {
        const result = db
          .delete(playlistItems)
          .where(and(eq(playlistItems.playlistId, playlistId), eq(playlistItems.videoId, videoId)))
          .run();

        return result.changes > 0;
      },
      list(playlistId) {
        return db
          .select()
          .from(playlistItems)
          .where(eq(playlistItems.playlistId, playlistId))
          .orderBy(asc(playlistItems.position), asc(playlistItems.videoId))
          .all();
      },
    },
  };
}
