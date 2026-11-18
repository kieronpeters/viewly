"use server";

import { getSessionAccount } from "@/lib/auth/google";
import { getDatabaseConnection } from "@/lib/db/client";
import { parseTakeoutWatchHistory, thumbnailFor } from "@/lib/history-import/parse-takeout";

export interface ImportResult {
  ok: boolean;
  imported?: number;
  message: string;
}

/**
 * Imports the owner's Google Takeout watch history into the local history table.
 *
 * Inserts are upserts on the video id: a re-import refreshes the timestamp and
 * snapshot instead of duplicating rows. No network call is made.
 */
export async function importWatchHistory(
  _previous: ImportResult | null,
  formData: FormData,
): Promise<ImportResult> {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose your watch-history.json file." };
  }

  let entries;
  try {
    entries = parseTakeoutWatchHistory(JSON.parse(await file.text()));
  } catch {
    return { ok: false, message: "That file is not a Takeout watch-history.json export." };
  }

  if (entries.length === 0) {
    return { ok: false, message: "No watchable video entries were found in that file." };
  }

  const { sqlite } = getDatabaseConnection();
  const account = await getSessionAccount().catch(() => null);
  const owner = account?.id ?? "local";
  const statement = sqlite.prepare(
    `INSERT INTO history
       (owner, video_id, title, channel_title, thumbnail_url, duration_seconds, last_viewed_at, view_count)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 1)
     ON CONFLICT(owner, video_id) DO UPDATE SET
       title = excluded.title,
       channel_title = excluded.channel_title,
       last_viewed_at = excluded.last_viewed_at,
       view_count = MAX(history.view_count, 1)`,
  );

  let imported = 0;
  const run = sqlite.transaction(() => {
    for (const entry of entries) {
      statement.run(
        owner,
        entry.videoId,
        entry.title,
        entry.channelTitle,
        thumbnailFor(entry.videoId),
        entry.watchedAt.getTime(),
      );
      imported += 1;
    }
  });

  run();

  return {
    ok: true,
    imported,
    message: `Imported ${imported} video${imported === 1 ? "" : "s"} into your local history.`,
  };
}
