import { listVideoNotes } from "@/features/notes";

import { WatchDiscussionTabs } from "./watch-discussion-tabs";

export interface WatchDiscussionProps {
  /** The video whose comments are listed and whose local notes are read. */
  videoId: string;
}

/**
 * Comments and notes region below the description.
 *
 * This half is a Server Component so the local notes are read once, on the
 * server, and passed into the client tab widget: the notes panel hydrates with
 * its content instead of flashing a loading state, and note bodies never make
 * a network request of their own. Comments stay self-loading inside their own
 * panel, where a YouTube failure is contained.
 *
 * The read shares the watch page's request-time render: `watch-page-content`
 * already sits inside the route's `<Suspense>` boundary and awaits runtime
 * `params`, so Cache Components does not capture it in the static shell.
 */
export function WatchDiscussion({ videoId }: WatchDiscussionProps) {
  return <WatchDiscussionTabs videoId={videoId} initialNotes={listVideoNotes(videoId)} />;
}
