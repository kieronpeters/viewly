import type { VideoNote } from "@/features/notes";

import { WatchDiscussionTabs } from "./watch-discussion-tabs";

export interface WatchDiscussionProps {
  /** The video whose comments are listed and whose local notes are shown. */
  videoId: string;
  /**
   * Notes read by the page's local-read boundary.
   *
   * The page reads them beside progress so a missing `video_notes` table can
   * become the authored database state before this panel renders; this
   * component stays free of database access.
   */
  initialNotes: readonly VideoNote[];
}

/**
 * Comments and notes region below the description.
 *
 * Notes arrive as props from the Server Component page, so the panel hydrates
 * with its content instead of flashing a loading state and note bodies never
 * make a network request of their own. Comments stay self-loading inside their
 * own panel, where a YouTube failure is contained.
 */
export function WatchDiscussion({ videoId, initialNotes }: WatchDiscussionProps) {
  return <WatchDiscussionTabs videoId={videoId} initialNotes={initialNotes} />;
}
