/**
 * Pure merge planning for a library backup import (T87).
 *
 * The plan is computed from a snapshot of the local database and the parsed
 * file, with no SQL and no I/O. That separation gives the import two useful
 * properties:
 *
 * - a **preview** is just `planMerge(current, incoming).counts` — it cannot
 *   write because it never touches the database;
 * - the **confirm** step re-plans against the current rows and hands the plan
 *   to the repository, which executes every insert and update in one
 *   transaction.
 *
 * ## Merge rules
 *
 * Identity is the natural key of each table: `video_id` for favourites, watch
 * later, history and progress; `playlist_id` for playlists; `(playlist_id,
 * video_id)` for playlist membership; note id for notes. An incoming row is:
 *
 * - **added** when no local row has that key;
 * - **skipped** when it is an exact duplicate, or when its conflict timestamp
 *   is not newer than the local row's;
 * - **replaced** when it differs and its conflict timestamp is strictly newer.
 *
 * Conflict timestamps are `saved_at` for favourites/watch later, `last_viewed_at`
 * for history, `updated_at` for playlists/notes/progress, and `added_at` for
 * playlist membership. Rows that exist only locally are never touched, deleted
 * or reordered, so an import can only add or refresh data.
 *
 * A playlist row and its membership are counted separately: a newer playlist
 * can rename itself while every local item survives, and an older playlist can
 * contribute a video it did not contain locally.
 */
import type {
  BackupData,
  BackupHistoryEntry,
  BackupNote,
  BackupPlaylist,
  BackupPlaylistItem,
  BackupProgress,
  BackupSavedVideo,
} from "./backup";

/** Added/skipped/replaced counters for one table. */
export interface MergeCounts {
  added: number;
  skipped: number;
  replaced: number;
}

/** Counters for every table plus their sum. */
export interface ImportCounts {
  favourites: MergeCounts;
  watchLater: MergeCounts;
  history: MergeCounts;
  playlists: MergeCounts;
  playlistItems: MergeCounts;
  notes: MergeCounts;
  progress: MergeCounts;
  total: MergeCounts;
}

/** A playlist item plus the playlist it belongs to, ready for the repository. */
export interface PlannedPlaylistItem extends BackupPlaylistItem {
  playlistId: string;
}

/** Insert/update operations for one table, with the matching counters. */
export interface MergeSection<T> {
  insert: T[];
  update: T[];
  counts: MergeCounts;
}

/** Everything {@link planMerge} decided, in an order the repository can apply. */
export interface MergePlan {
  counts: ImportCounts;
  favourites: MergeSection<BackupSavedVideo>;
  watchLater: MergeSection<BackupSavedVideo>;
  history: MergeSection<BackupHistoryEntry>;
  playlists: MergeSection<BackupPlaylist>;
  playlistItems: MergeSection<PlannedPlaylistItem>;
  notes: MergeSection<BackupNote>;
  progress: MergeSection<BackupProgress>;
}

/**
 * Computes the exact changes an import would make.
 *
 * The function is pure: every array in `current` and `incoming` is read only.
 * The caller may run it for a preview and again for the confirm step; the
 * second call re-reads the database, so a change made in between is reflected.
 */
export function planMerge(current: BackupData, incoming: BackupData): MergePlan {
  const favourites = createSection<BackupSavedVideo>();
  const watchLater = createSection<BackupSavedVideo>();
  const history = createSection<BackupHistoryEntry>();
  const playlists = createSection<BackupPlaylist>();
  const playlistItems = createSection<PlannedPlaylistItem>();
  const notes = createSection<BackupNote>();
  const progress = createSection<BackupProgress>();

  const currentFavourites = new Map(current.favourites.map((row) => [row.videoId, row]));
  const currentWatchLater = new Map(current.watchLater.map((row) => [row.videoId, row]));
  const currentHistory = new Map(current.history.map((row) => [row.videoId, row]));
  const currentPlaylists = new Map(current.playlists.map((row) => [row.id, row]));
  const currentNotes = new Map(current.notes.map((row) => [row.id, row]));
  const currentProgress = new Map(current.progress.map((row) => [row.videoId, row]));

  for (const row of incoming.favourites) {
    decide(
      favourites,
      currentFavourites.get(row.videoId),
      row,
      sameSavedVideo,
      (left, right) => left.savedAt.getTime() > right.savedAt.getTime(),
    );
  }

  for (const row of incoming.watchLater) {
    decide(
      watchLater,
      currentWatchLater.get(row.videoId),
      row,
      sameSavedVideo,
      (left, right) => left.savedAt.getTime() > right.savedAt.getTime(),
    );
  }

  for (const row of incoming.history) {
    decide(
      history,
      currentHistory.get(row.videoId),
      row,
      sameHistoryEntry,
      (left, right) => left.lastViewedAt.getTime() > right.lastViewedAt.getTime(),
    );
  }

  for (const row of incoming.notes) {
    decide(
      notes,
      currentNotes.get(row.id),
      row,
      sameNote,
      (left, right) => left.updatedAt.getTime() > right.updatedAt.getTime(),
    );
  }

  for (const row of incoming.progress) {
    decide(
      progress,
      currentProgress.get(row.videoId),
      row,
      sameProgress,
      (left, right) => left.updatedAt.getTime() > right.updatedAt.getTime(),
    );
  }

  const currentItems = new Map(
    current.playlists.flatMap((playlist) =>
      playlist.items.map(
        (item) =>
          [
            playlistItemKey(playlist.id, item.videoId),
            { ...item, playlistId: playlist.id },
          ] as const,
      ),
    ),
  );

  for (const playlist of incoming.playlists) {
    decide(
      playlists,
      currentPlaylists.get(playlist.id),
      playlist,
      samePlaylist,
      (left, right) => left.updatedAt.getTime() > right.updatedAt.getTime(),
    );

    for (const item of playlist.items) {
      const planned: PlannedPlaylistItem = { ...item, playlistId: playlist.id };

      decide(
        playlistItems,
        currentItems.get(playlistItemKey(playlist.id, item.videoId)),
        planned,
        samePlaylistItem,
        (left, right) => left.addedAt.getTime() > right.addedAt.getTime(),
      );
    }
  }

  return {
    counts: {
      favourites: favourites.counts,
      watchLater: watchLater.counts,
      history: history.counts,
      playlists: playlists.counts,
      playlistItems: playlistItems.counts,
      notes: notes.counts,
      progress: progress.counts,
      total: sumCounts([
        favourites.counts,
        watchLater.counts,
        history.counts,
        playlists.counts,
        playlistItems.counts,
        notes.counts,
        progress.counts,
      ]),
    },
    favourites,
    watchLater,
    history,
    playlists,
    playlistItems,
    notes,
    progress,
  };
}

function decide<T>(
  section: MergeSection<T>,
  existing: T | undefined,
  incoming: T,
  isSame: (left: T, right: T) => boolean,
  isIncomingNewer: (incoming: T, existing: T) => boolean,
): void {
  if (existing === undefined) {
    section.insert.push(incoming);
    section.counts.added += 1;
    return;
  }

  if (isSame(existing, incoming)) {
    section.counts.skipped += 1;
    return;
  }

  if (isIncomingNewer(incoming, existing)) {
    section.update.push(incoming);
    section.counts.replaced += 1;
    return;
  }

  // Same key but not newer: keep the local row, and never delete it.
  section.counts.skipped += 1;
}

function createSection<T>(): MergeSection<T> {
  return { insert: [], update: [], counts: { added: 0, skipped: 0, replaced: 0 } };
}

function sumCounts(counts: readonly MergeCounts[]): MergeCounts {
  return counts.reduce(
    (total, item) => ({
      added: total.added + item.added,
      skipped: total.skipped + item.skipped,
      replaced: total.replaced + item.replaced,
    }),
    { added: 0, skipped: 0, replaced: 0 },
  );
}

function playlistItemKey(playlistId: string, videoId: string): string {
  return `${playlistId}\u0000${videoId}`;
}

function sameSavedVideo(left: BackupSavedVideo, right: BackupSavedVideo): boolean {
  return (
    left.videoId === right.videoId &&
    left.title === right.title &&
    left.channelTitle === right.channelTitle &&
    left.thumbnailUrl === right.thumbnailUrl &&
    left.durationSeconds === right.durationSeconds &&
    left.savedAt.getTime() === right.savedAt.getTime()
  );
}

function sameHistoryEntry(left: BackupHistoryEntry, right: BackupHistoryEntry): boolean {
  return (
    sameSavedVideo(
      { ...left, savedAt: left.lastViewedAt },
      { ...right, savedAt: right.lastViewedAt },
    ) && left.viewCount === right.viewCount
  );
}

function samePlaylist(left: BackupPlaylist, right: BackupPlaylist): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    left.updatedAt.getTime() === right.updatedAt.getTime()
  );
}

function samePlaylistItem(left: PlannedPlaylistItem, right: PlannedPlaylistItem): boolean {
  return (
    left.playlistId === right.playlistId &&
    left.videoId === right.videoId &&
    left.position === right.position &&
    left.addedAt.getTime() === right.addedAt.getTime()
  );
}

function sameNote(left: BackupNote, right: BackupNote): boolean {
  return (
    left.id === right.id &&
    left.videoId === right.videoId &&
    left.body === right.body &&
    left.startSeconds === right.startSeconds &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    left.updatedAt.getTime() === right.updatedAt.getTime()
  );
}

function sameProgress(left: BackupProgress, right: BackupProgress): boolean {
  return (
    left.videoId === right.videoId &&
    left.positionSeconds === right.positionSeconds &&
    left.durationSeconds === right.durationSeconds &&
    left.updatedAt.getTime() === right.updatedAt.getTime()
  );
}
