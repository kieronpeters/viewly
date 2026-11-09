import { notFound } from "next/navigation";

import { getWatchVideo } from "@/features/video";
import type { VideoDetail } from "@/shared/types";

import { parseWatchVideoId } from "./parse-watch-video-id";

export interface WatchPageContentProps {
  /** Next 16 passes `params` as a promise; only this boundary awaits it. */
  params: Promise<{ videoId: string }>;
}

/**
 * Data half of the watch route.
 *
 * Runs inside the page's `<Suspense>` boundary: it awaits the runtime `params`
 * and the uncached `getWatchVideo` read, so the breadcrumb and skeleton stay in
 * the prerendered shell. Invalid ids and unknown/private videos both resolve to
 * the segment's 404 before anything reaches the player or metadata panel.
 */
export async function WatchPageContent({ params }: WatchPageContentProps) {
  const { videoId } = await params;
  const id = parseWatchVideoId(videoId);

  if (id === null) {
    notFound();
  }

  const video = await getWatchVideo(id);

  if (video === null) {
    notFound();
  }

  return <WatchVideoDetail video={video} />;
}

export interface WatchVideoDetailProps {
  /** Already normalized by the YouTube client; never built from a raw payload. */
  video: VideoDetail;
}

/**
 * Layout half of the watch route: heading, player slot and side panel slot.
 *
 * The player (T30) and the metadata/description panel (T31) are intentionally
 * placeholders. Each slot is its own labelled landmark so replacing the
 * placeholder does not change the page structure.
 */
export function WatchVideoDetail({ video }: WatchVideoDetailProps) {
  return (
    <article aria-labelledby="watch-title" className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1
          id="watch-title"
          className="text-pretty text-xl font-semibold tracking-tight break-words text-foreground sm:text-2xl lg:text-3xl"
        >
          {video.title}
        </h1>
        {video.channelTitle === "" ? null : (
          <p className="text-sm text-muted-foreground">
            <span className="sr-only">Channel: </span>
            <span>{video.channelTitle}</span>
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* T30 slot: replace the placeholder with the embedded player. */}
        <section
          data-slot="watch-player-slot"
          aria-labelledby="watch-player-heading"
          className="flex min-w-0 flex-col"
        >
          <h2 id="watch-player-heading" className="sr-only">
            Video player
          </h2>
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card px-4 text-center">
            <p className="text-sm font-medium text-foreground">Player placeholder</p>
            <p className="text-sm text-muted-foreground">T30 mounts the embedded player here.</p>
          </div>
        </section>

        {/* T31 slot: replace the placeholder with metadata and description. */}
        <aside
          data-slot="watch-details-slot"
          aria-labelledby="watch-details-heading"
          className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4"
        >
          <h2 id="watch-details-heading" className="text-sm font-semibold text-foreground">
            Video details
          </h2>
          <p className="text-sm text-muted-foreground">
            T31 mounts the metadata and description panel here.
          </p>
        </aside>
      </div>
    </article>
  );
}
