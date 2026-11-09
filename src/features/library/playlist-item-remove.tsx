"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { removeFromPlaylist } from "./playlist-actions";

export interface PlaylistItemRemoveProps {
  playlistId: string;
  videoId: string;
  /** Video title, or the id when the metadata is unavailable. */
  label: string;
}

/**
 * Remove one video from the playlist currently being viewed.
 *
 * The action revalidates `/library` and this detail path, so a successful
 * remove drops the row on the server response; no local list copy is kept. The
 * button carries the video label in its accessible name because a playlist can
 * show many identical "Remove" buttons.
 */
export function PlaylistItemRemove({ playlistId, videoId, label }: PlaylistItemRemoveProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    setError(null);

    startTransition(async () => {
      try {
        const result = await removeFromPlaylist(playlistId, videoId);

        if (!result.removed) {
          setError("This video is no longer in the playlist.");
        }
      } catch {
        setError("Could not remove the video. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        aria-label={`Remove ${label} from playlist`}
        aria-busy={isPending}
        disabled={isPending}
        onClick={handleRemove}
      >
        Remove
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
