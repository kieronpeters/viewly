"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_PLAYLIST_NAME_LENGTH } from "@/shared/validation";

import { createPlaylist } from "./playlist-actions";

/**
 * Minimal create form for the `?tab=playlists` library tab (T36).
 *
 * T37 owns the full tabbed page; this form only needs to be usable and
 * accessible today. It is a real `<form>` with a labelled input, so Enter
 * submits and the control works before hydration. The action revalidates
 * `/library`, which refreshes the list without a manual `router.refresh()`.
 *
 * The input is cleared only after a successful create; a failure leaves the
 * typed name in place so the user can retry.
 */
export function PlaylistCreateForm() {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = useId();
  const errorId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const playlistName = name.trim();

    if (playlistName.length === 0) {
      setError("Enter a playlist name.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await createPlaylist(playlistName);
        setName("");
        setStatus(`Created “${result.name}”.`);
      } catch {
        setError("Could not create the playlist. Please try again.");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Create a playlist"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
    >
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        Playlist name
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          value={name}
          maxLength={MAX_PLAYLIST_NAME_LENGTH}
          autoComplete="off"
          disabled={isPending}
          invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setName(event.target.value)}
          className="min-h-11 sm:max-w-xs"
        />
        <Button type="submit" className="min-h-11" disabled={isPending}>
          Create playlist
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
