"use client";

import { ListPlus } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_PLAYLIST_NAME_LENGTH } from "@/shared/validation";

import { addToPlaylist, createPlaylist } from "./playlist-actions";
import type { PlaylistOption, PlaylistSnapshot } from "./playlists";

/** Copy shown when an add or create fails for a reason the UI cannot explain. */
const ADD_ERROR_MESSAGE = "Could not add to playlist. Please try again.";
const CREATE_ERROR_MESSAGE = "Could not create the playlist. Please try again.";

export interface PlaylistPickerProps {
  /** Snapshot of the video being saved; already normalized by the caller. */
  video: PlaylistSnapshot;
  /** Playlists read on the server for this render, plus any created here. */
  playlists: readonly PlaylistOption[];
  /** Optional layout classes; the caller owns positioning (e.g. the card overlay). */
  className?: string;
}

/**
 * Opt-in "add to playlist" control for the watch page and library cards.
 *
 * ## Why not a dialog
 *
 * The panel is a plain, inline `div` toggled with React state. It is not a
 * `<dialog>` and no popover/menu library is involved, so the markup stays in
 * the normal tab order and the component adds no dependency. The trigger is a
 * real `<button type="button">` (never nested in the card link) with
 * `aria-expanded` and `aria-controls`, so assistive technology can follow the
 * open/closed state. The panel is a labelled `role="group"` rather than a menu:
 * its children are ordinary buttons and a form, not menu items.
 *
 * ## Keyboard behaviour
 *
 * Opening moves focus to the first playlist button. Escape closes the panel
 * from anywhere inside it and returns focus to the trigger. Clicking outside
 * also closes it. A successful add closes the panel and focuses the trigger, so
 * the user is never stranded on a removed control.
 *
 * ## New playlists
 *
 * "New playlist" reveals a name field in the same panel; submitting creates the
 * playlist and immediately adds the current video. The new option is appended
 * to local state so the picker can be used again without a page reload. The
 * server action revalidates `/library`, so the library list updates too.
 */
export function PlaylistPicker({ video, playlists, className }: PlaylistPickerProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<readonly PlaylistOption[]>(playlists);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const headingId = useId();
  const nameId = useId();

  // Focus the first actionable control when the panel opens, and the name field
  // when the inline create form replaces the list.
  useEffect(() => {
    if (!open) {
      return;
    }

    if (creating) {
      nameRef.current?.focus();
      return;
    }

    const firstButton = containerRef.current?.querySelector<HTMLButtonElement>(
      '[data-slot="playlist-picker-panel"] button',
    );
    firstButton?.focus();
  }, [open, creating]);

  // A click anywhere outside the control dismisses the panel. The listener is
  // only attached while open, so closed cards cost nothing.
  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node) !== true) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleToggle() {
    setOpen((current) => !current);
    setCreating(false);
    setName("");
    setError(null);
    setStatus(null);
  }

  function closeAndFocusTrigger() {
    setOpen(false);
    setCreating(false);
    setName("");
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") {
      return;
    }

    event.stopPropagation();
    closeAndFocusTrigger();
  }

  function handleAdd(option: PlaylistOption) {
    setError(null);
    setStatus(null);

    startTransition(async () => {
      try {
        const result = await addToPlaylist(option.id, video);

        if (!result.added) {
          setError("That playlist no longer exists.");
          return;
        }

        setStatus(`Added to ${option.name}.`);
        closeAndFocusTrigger();
      } catch {
        setError(ADD_ERROR_MESSAGE);
      }
    });
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
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
        const created = await createPlaylist(playlistName);
        const option = { id: created.playlistId, name: created.name };

        setOptions((current) => [...current, option]);

        const result = await addToPlaylist(created.playlistId, video);

        if (!result.added) {
          setCreating(false);
          setError(
            "The playlist was created, but the video could not be added. Choose it from the list to retry.",
          );
          return;
        }

        setStatus(`Added to ${created.name}.`);
        closeAndFocusTrigger();
      } catch {
        setError(CREATE_ERROR_MESSAGE);
      }
    });
  }

  return (
    <div
      ref={containerRef}
      data-slot="playlist-picker"
      className={cn("relative flex flex-col items-end gap-1", className)}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Add to playlist"
        aria-expanded={open}
        aria-controls={panelId}
        aria-busy={isPending}
        disabled={isPending}
        onClick={handleToggle}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors outline-none",
          "hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:opacity-60",
          open && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
        )}
      >
        <ListPlus aria-hidden="true" className="size-5" strokeWidth={2} />
      </button>

      {open ? (
        <div
          id={panelId}
          data-slot="playlist-picker-panel"
          role="group"
          aria-labelledby={headingId}
          className="absolute top-full right-0 z-20 mt-2 flex w-60 max-w-[calc(100vw_-_2rem)] flex-col gap-2 rounded-xl border border-border bg-background p-3 text-left shadow-lg"
        >
          <p
            id={headingId}
            className="text-xs font-semibold tracking-wide text-foreground uppercase"
          >
            Add to playlist
          </p>

          {creating ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-2">
              <label htmlFor={nameId} className="text-xs text-muted-foreground">
                New playlist name
              </label>
              <Input
                ref={nameRef}
                id={nameId}
                value={name}
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                autoComplete="off"
                disabled={isPending}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" className="min-h-11" disabled={isPending}>
                  Create and add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  disabled={isPending}
                  onClick={() => {
                    setCreating(false);
                    setName("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              {options.length === 0 ? (
                <p className="text-xs text-muted-foreground">No playlists yet.</p>
              ) : (
                <ul role="list" className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                  {options.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleAdd(option)}
                        className="flex min-h-11 w-full items-center rounded-md px-2 py-1.5 text-left text-sm break-words text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      >
                        {option.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11"
                disabled={isPending}
                onClick={() => {
                  setCreating(true);
                  setError(null);
                }}
              >
                New playlist
              </Button>
            </>
          )}
        </div>
      ) : null}

      {status === null ? null : (
        <p
          role="status"
          className="max-w-44 rounded bg-background/95 px-1.5 py-0.5 text-right text-xs break-words text-muted-foreground"
        >
          {status}
        </p>
      )}

      {error === null ? null : (
        <p
          role="alert"
          className="max-w-44 rounded bg-background/95 px-1.5 py-0.5 text-right text-xs break-words text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
