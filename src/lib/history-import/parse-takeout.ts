/**
 * Parser for the owner's Google Takeout `watch-history.json`.
 *
 * Pure and dependency-free so it can be unit-tested. Takeout is the only
 * legitimate source of YouTube watch history: the Data API has no history
 * endpoint, and nothing here writes anything back to YouTube.
 */

export interface ImportedWatch {
  videoId: string;
  title: string;
  channelTitle: string;
  watchedAt: Date;
}

interface TakeoutEntry {
  header?: string;
  title?: string;
  titleUrl?: string;
  subtitles?: { name?: string; url?: string }[];
  time?: string;
}

const VIDEO_ID = /[?&]v=([A-Za-z0-9_-]{11})/;

function normalizeTitle(raw: string): string {
  return raw.replace(/^Watched\s+/i, "").trim();
}

/**
 * Returns valid watch entries, newest first, deduplicated by video id.
 * Entries for removed videos, non-video URLs and bad timestamps are skipped.
 */
export function parseTakeoutWatchHistory(json: unknown): ImportedWatch[] {
  if (!Array.isArray(json)) {
    throw new Error("takeout_not_an_array");
  }

  const byId = new Map<string, ImportedWatch>();

  for (const raw of json as TakeoutEntry[]) {
    if (!raw || typeof raw !== "object") continue;

    const match = typeof raw.titleUrl === "string" ? VIDEO_ID.exec(raw.titleUrl) : null;
    const videoId = match?.[1];
    if (!videoId) continue;

    const watchedAt = raw.time ? new Date(raw.time) : null;
    if (!watchedAt || Number.isNaN(watchedAt.getTime())) continue;

    const title = normalizeTitle(raw.title ?? "");
    if (title === "") continue;

    const channelTitle = raw.subtitles?.[0]?.name?.trim() ?? "";
    const existing = byId.get(videoId);

    if (!existing || watchedAt.getTime() > existing.watchedAt.getTime()) {
      byId.set(videoId, { videoId, title, channelTitle, watchedAt });
    }
  }

  return [...byId.values()].sort((a, b) => b.watchedAt.getTime() - a.watchedAt.getTime());
}

/** Standard thumbnail for a video id, without calling the API. */
export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
