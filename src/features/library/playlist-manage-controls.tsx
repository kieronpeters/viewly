"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_PLAYLIST_NAME_LENGTH } from "@/shared/validation";

import { deletePlaylist, renamePlaylist } from "./playlist-actions";

export interface PlaylistManageProps {
  playlistId: string;
  /** The name read on the server for this render. */
  name: string;
}

/**
 * Inline rename control for the playlist detail page.
 *
 * The form is a real `<form>` with a labelled input. A successful rename
 * revalidates `/library` and the detail path, so the heading updates without a
 * client-side copy of the playlist state. On failure the typed value stays put.
 */
export function PlaylistRenameForm({ playlistId, name }: PlaylistManageProps) {
  const [value, setValue] = useState(name);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = useId();
  const errorId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const nextName = value.trim();

    if (nextName.length === 0) {
      setError("Enter a playlist name.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await renamePlaylist(playlistId, nextName);

        if (!result.renamed) {
          setError("This playlist no longer exists.");
          return;
        }

        setValue(result.name);
        setStatus("Playlist renamed.");
      } catch {
        setError("Could not rename the playlist. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Rename playlist" className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        Playlist name
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          value={value}
          maxLength={MAX_PLAYLIST_NAME_LENGTH}
          autoComplete="off"
          disabled={isPending}
          invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-11 sm:max-w-xs"
        />
        <Button type="submit" variant="outline" className="min-h-11" disabled={isPending}>
          Rename
        </Button>
      </div>

      {status === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {error === null ? null : (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Two-step delete control for the playlist detail page.
 *
 * A dialog library is deliberately not used: the confirmation is an inline
 * `role="group"` that replaces the trigger, with a real Cancel button. After a
 * successful delete the detail route no longer exists, so the control navigates
 * back to the playlist list instead of waiting for a re-render of the 404.
 */
export function PlaylistDeleteButton({ playlistId, name }: PlaylistManageProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    setError(null);

    startTransition(async () => {
      try {
        const result = await deletePlaylist(playlistId);

        if (!result.deleted) {
          setError("This playlist no longer exists.");
          return;
        }

        router.push("/library?tab=playlists");
      } catch {
        setError("Could not delete the playlist. Please try again.");
      }
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="destructive"
          className="min-h-11"
          onClick={() => setConfirming(true)}
        >
          Delete playlist
        </Button>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Confirm delete playlist"
      className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 p-3"
    >
      <p className="text-sm break-words text-foreground">
        Delete “{name}”? This also removes every video from the playlist.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          className="min-h-11"
          disabled={isPending}
          onClick={handleDelete}
        >
          Delete permanently
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={isPending}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
