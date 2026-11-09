import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VideoCard } from "@/components/video/video-card";
import { getPlaylistForPage, type PlaylistPageData } from "@/features/library";
import { PlaylistItemRemove } from "@/features/library/playlist-item-remove";
import {
  PlaylistDeleteButton,
  PlaylistRenameForm,
} from "@/features/library/playlist-manage-controls";
import { tryParsePlaylistId } from "@/features/library/playlists";
import { getVideos } from "@/lib/youtube/client";
import { cn } from "@/lib/utils";
import type { VideoSummary } from "@/shared/types";
import { isVideoId } from "@/shared/validation";

export interface PlaylistPageContentProps {
  /** Next 16 passes `params` as a promise; only this boundary awaits it. */
  params: Promise<{ playlistId: string }>;
}

/** One stored item plus the metadata `getVideos` returned for it, if any. */
export interface PlaylistVideoRow {
  videoId: string;
  /** `null` when YouTube did not return the id (deleted, private, unknown). */
  video: VideoSummary | null;
}

/**
 * Data half of the playlist detail route.
 *
 * Playlist items store only the video id, so this component performs the one
 * metadata read the page needs: `getVideos` for every valid stored id. The
 * result is a map keyed by id, which preserves the playlist's own position
 * order while allowing an id with no metadata to render an honest fallback row.
 *
 * The read happens behind the page's `<Suspense>` boundary next to `params`, so
 * the static shell can prerender while the playlist resolves per request.
 */
export async function PlaylistPageContent({ params }: PlaylistPageContentProps) {
  const { playlistId } = await params;
  const id = tryParsePlaylistId(playlistId);

  if (id === null) {
    notFound();
  }

  const playlist = getPlaylistForPage(id);

  if (playlist === null) {
    notFound();
  }

  // A row written outside this app (or a future schema migration) could hold a
  // malformed id. Filtering keeps one bad row from failing the whole batch:
  // `getVideos` validates every id before its first request.
  const requestedIds = playlist.videoIds.filter(isVideoId);
  const videos = requestedIds.length === 0 ? [] : await getVideos(requestedIds);
  const byId = new Map(videos.map((video) => [video.id, video]));

  const rows: PlaylistVideoRow[] = playlist.videoIds.map((videoId) => ({
    videoId,
    video: byId.get(videoId) ?? null,
  }));

  return <PlaylistDetailView playlist={playlist} rows={rows} />;
}

export interface PlaylistDetailViewProps {
  /** Stored playlist identity and name. */
  playlist: PlaylistPageData;
  /** Items in playlist order, with `null` metadata where YouTube had none. */
  rows: readonly PlaylistVideoRow[];
}

/**
 * Layout half of the playlist detail route.
 *
 * Available videos use the same `VideoCard` as every other list, so their
 * thumbnail, title and watch link stay consistent. Missing metadata renders a
 * full-width "Unavailable video" row that still shows the stored id and offers
 * the same remove action, so the user can clean up a deleted video instead of
 * being stuck with an invisible entry.
 */
export function PlaylistDetailView({ playlist, rows }: PlaylistDetailViewProps) {
  const itemLabel = rows.length === 1 ? "video" : "videos";

  return (
    <article aria-labelledby="playlist-title" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1
            id="playlist-title"
            className="text-pretty text-2xl font-semibold tracking-tight break-words text-foreground sm:text-3xl"
          >
            {playlist.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} {itemLabel}, in playlist order.
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
          <PlaylistRenameForm playlistId={playlist.id} name={playlist.name} />
          <PlaylistDeleteButton playlistId={playlist.id} name={playlist.name} />
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No videos in this playlist yet"
          message="Add videos from the watch page or from your library."
          action={
            <Button asChild variant="outline">
              <Link href="/">Browse videos</Link>
            </Button>
          }
        />
      ) : (
        <ol
          role="list"
          aria-label={`Videos in ${playlist.name}`}
          className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {rows.map(({ videoId, video }) => (
            <li
              key={videoId}
              className={cn(
                "min-w-0",
                video === null && "sm:col-span-2 lg:col-span-3 xl:col-span-4",
              )}
            >
              {video === null ? (
                <div
                  data-slot="playlist-unavailable"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-sm font-medium text-foreground">Unavailable video</p>
                    <p className="text-xs break-all text-muted-foreground">
                      Video id: <span className="font-mono">{videoId}</span>
                    </p>
                  </div>
                  <PlaylistItemRemove
                    playlistId={playlist.id}
                    videoId={videoId}
                    label={`unavailable video ${videoId}`}
                  />
                </div>
              ) : (
                <div className="flex h-full flex-col gap-2">
                  <VideoCard video={video} className="h-full" />
                  <PlaylistItemRemove
                    playlistId={playlist.id}
                    videoId={videoId}
                    label={video.title}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
