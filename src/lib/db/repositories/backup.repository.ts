/**
 * Query layer for the versioned library backup (T87).
 *
 * ## Shape
 *
 * Like the other repositories, this module exports a factory
 * ({@link createBackupRepository}) rather than a process-wide singleton, so
 * callers pass the Drizzle client they already have and tests build their own
 * against a migrated temporary file.
 *
 * ```ts
 * import { getDb } from "@/lib/db/client";
 * import { createBackupRepository } from "@/lib/db/repositories/backup.repository";
 *
 * const backups = createBackupRepository(getDb());
 * ```
 *
 * ## Responsibilities
 *
 * - {@link BackupRepository.read} materialises every library table into the
 *   plain `BackupData` shape. This is the only place the backup feature reads
 *   SQLite.
 * - {@link BackupRepository.apply} executes a {@link MergePlan} computed by the
 *   pure merge module. Every insert and update for the whole import runs in one
 *   `db.transaction`, so a constraint failure rolls the entire import back and
 *   the local database is unchanged.
 *
 * The repository never decides *what* to merge: that policy lives in
 * `src/features/backup/backup-merge.ts`. It also never deletes a row, which is
 * what makes "an import can only add or refresh" true at the storage layer.
 *
 * ## Ordering
 *
 * `read` does not promise an order. The envelope builder sorts every list
 * before serialization and the merge planner keys rows by natural id, so a
 * SQLite row order change cannot leak into the file or the counts.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import {
  favourites,
  history,
  playlistItems,
  playlists,
  videoNotes,
  videoProgress,
  watchLater,
} from "@/db/schema";
import type { ViewlyDatabase } from "@/lib/db/client";

import type {
  BackupData,
  BackupHistoryEntry,
  BackupNote,
  BackupPlaylist,
  BackupProgress,
  BackupSavedVideo,
} from "@/features/backup/backup";
import type { MergePlan } from "@/features/backup/backup-merge";

/** Typed query surface for the backup feature. */
export interface BackupRepository {
  /** Reads every library table into the neutral backup shape. */
  read(): BackupData;
  /**
   * Applies a merge plan in one transaction.
   *
   * The plan is expected to come from a fresh {@link read} snapshot. If any
   * statement fails, the transaction rolls back and the error is rethrown, so
   * a failed import changes nothing.
   */
  apply(plan: MergePlan): void;
}

/** Builds the backup query surface over an existing Drizzle client. */
export function createBackupRepository(db: ViewlyDatabase): BackupRepository {
  return {
    read() {
      return {
        favourites: db.select().from(favourites).all().map(toSavedVideo),
        watchLater: db.select().from(watchLater).all().map(toSavedVideo),
        history: db.select().from(history).all().map(toHistoryEntry),
        playlists: readPlaylists(db),
        notes: db.select().from(videoNotes).all().map(toNote),
        progress: db.select().from(videoProgress).all().map(toProgress),
      };
    },

    apply(plan) {
      db.transaction((tx) => {
        for (const row of plan.favourites.insert) {
          tx.insert(favourites).values(row).run();
        }

        for (const row of plan.favourites.update) {
          tx.update(favourites)
            .set({
              title: row.title,
              channelTitle: row.channelTitle,
              thumbnailUrl: row.thumbnailUrl,
              durationSeconds: row.durationSeconds,
              savedAt: row.savedAt,
            })
            .where(eq(favourites.videoId, row.videoId))
            .run();
        }

        for (const row of plan.watchLater.insert) {
          tx.insert(watchLater).values(row).run();
        }

        for (const row of plan.watchLater.update) {
          tx.update(watchLater)
            .set({
              title: row.title,
              channelTitle: row.channelTitle,
              thumbnailUrl: row.thumbnailUrl,
              durationSeconds: row.durationSeconds,
              savedAt: row.savedAt,
            })
            .where(eq(watchLater.videoId, row.videoId))
            .run();
        }

        for (const row of plan.history.insert) {
          tx.insert(history).values(row).run();
        }

        for (const row of plan.history.update) {
          tx.update(history)
            .set({
              title: row.title,
              channelTitle: row.channelTitle,
              thumbnailUrl: row.thumbnailUrl,
              durationSeconds: row.durationSeconds,
              lastViewedAt: row.lastViewedAt,
              viewCount: row.viewCount,
            })
            .where(eq(history.videoId, row.videoId))
            .run();
        }

        for (const row of plan.playlists.insert) {
          tx.insert(playlists)
            .values({
              id: row.id,
              name: row.name,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            })
            .run();
        }

        for (const row of plan.playlists.update) {
          tx.update(playlists)
            .set({
              name: row.name,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            })
            .where(eq(playlists.id, row.id))
            .run();
        }

        for (const row of plan.playlistItems.insert) {
          tx.insert(playlistItems)
            .values({
              playlistId: row.playlistId,
              videoId: row.videoId,
              position: row.position,
              addedAt: row.addedAt,
            })
            .run();
        }

        for (const row of plan.playlistItems.update) {
          tx.update(playlistItems)
            .set({ position: row.position, addedAt: row.addedAt })
            .where(
              and(
                eq(playlistItems.playlistId, row.playlistId),
                eq(playlistItems.videoId, row.videoId),
              ),
            )
            .run();
        }

        for (const row of plan.notes.insert) {
          tx.insert(videoNotes).values(row).run();
        }

        for (const row of plan.notes.update) {
          tx.update(videoNotes)
            .set({
              videoId: row.videoId,
              body: row.body,
              startSeconds: row.startSeconds,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            })
            .where(eq(videoNotes.id, row.id))
            .run();
        }

        for (const row of plan.progress.insert) {
          tx.insert(videoProgress).values(row).run();
        }

        for (const row of plan.progress.update) {
          tx.update(videoProgress)
            .set({
              positionSeconds: row.positionSeconds,
              durationSeconds: row.durationSeconds,
              updatedAt: row.updatedAt,
            })
            .where(eq(videoProgress.videoId, row.videoId))
            .run();
        }
      });
    },
  };
}

/** Reads playlists and groups their items by playlist id. */
function readPlaylists(db: ViewlyDatabase): BackupPlaylist[] {
  const itemRows = db.select().from(playlistItems).all();
  const itemsByPlaylist = new Map<string, { videoId: string; position: number; addedAt: Date }[]>();

  for (const row of itemRows) {
    const items = itemsByPlaylist.get(row.playlistId) ?? [];
    items.push({
      videoId: row.videoId,
      position: row.position,
      addedAt: row.addedAt,
    });
    itemsByPlaylist.set(row.playlistId, items);
  }

  return db
    .select()
    .from(playlists)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: itemsByPlaylist.get(row.id) ?? [],
    }));
}

function toSavedVideo(
  row: typeof favourites.$inferSelect | typeof watchLater.$inferSelect,
): BackupSavedVideo {
  return {
    videoId: row.videoId,
    title: row.title,
    channelTitle: row.channelTitle,
    thumbnailUrl: row.thumbnailUrl,
    durationSeconds: row.durationSeconds,
    savedAt: row.savedAt,
  };
}

function toHistoryEntry(row: typeof history.$inferSelect): BackupHistoryEntry {
  return {
    videoId: row.videoId,
    title: row.title,
    channelTitle: row.channelTitle,
    thumbnailUrl: row.thumbnailUrl,
    durationSeconds: row.durationSeconds,
    lastViewedAt: row.lastViewedAt,
    viewCount: row.viewCount,
  };
}

function toNote(row: typeof videoNotes.$inferSelect): BackupNote {
  return {
    id: row.id,
    videoId: row.videoId,
    body: row.body,
    startSeconds: row.startSeconds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProgress(row: typeof videoProgress.$inferSelect): BackupProgress {
  return {
    videoId: row.videoId,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    updatedAt: row.updatedAt,
  };
}
