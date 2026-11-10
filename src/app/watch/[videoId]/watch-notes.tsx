"use client";

import { StickyNote } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { addNote, deleteNote, editNote } from "@/features/notes/actions";
import { formatNoteTimestamp, type VideoNote } from "@/features/notes/notes";
import { MAX_NOTE_BODY_LENGTH } from "@/shared/validation";

/** What the panel is currently doing, so every control can disable together. */
type BusyState =
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly id: string }
  | { readonly kind: "delete"; readonly id: string }
  | null;

export interface WatchNotesProps {
  /** The video the notes belong to. */
  videoId: string;
  /** Notes read on the server for this render, newest first. */
  initialNotes: readonly VideoNote[];
}

/**
 * Local notes for the watch page's "Your notes" tab (T79).
 *
 * Notes are a private scratchpad stored in SQLite: no account, no YouTube
 * comment and no request of their own. The server reads the list once and
 * passes it in, so the panel renders its real content on hydration; the
 * composer and the inline editor then apply each action's returned row to the
 * local list, with the action's `revalidatePath` keeping the server render in
 * step.
 *
 * States the UI distinguishes:
 *
 * - empty: an authored "No notes yet" placeholder under the composer;
 * - ready: notes newest first, each with a created timestamp and, after an
 *   edit, an "Edited" timestamp;
 * - composing/editing/saving: the relevant controls are disabled while the
 *   action is in flight;
 * - validation failure: the draft is kept and an inline `role="alert"`
 *   explains what to fix;
 * - action failure: an inline `role="alert"` above the list, with the list
 *   left intact so nothing is lost.
 *
 * Bodies are rendered as React text nodes with `whitespace-pre-line`, never as
 * HTML.
 */
export function WatchNotes({ videoId, initialNotes }: WatchNotesProps) {
  const [notes, setNotes] = useState<VideoNote[]>(() => [...initialNotes]);
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [isPending, startTransition] = useTransition();

  const draftId = useId();
  const draftCounterId = useId();
  const draftErrorId = useId();

  const isBusy = busy !== null || isPending;
  const draftLength = countCharacters(draft);

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setListMessage(null);

    const body = draft.trim();
    const validationError = validateDraft(body);

    if (validationError !== null) {
      setComposerError(validationError);
      return;
    }

    setComposerError(null);
    setBusy({ kind: "add" });

    startTransition(async () => {
      try {
        const note = await addNote(videoId, body);
        setNotes((current) => [note, ...current]);
        setDraft("");
      } catch {
        setComposerError("Could not save your note. Please try again.");
      } finally {
        setBusy(null);
      }
    });
  }

  function startEditing(note: VideoNote) {
    setEditingId(note.id);
    setEditingDraft(note.body);
    setEditingError(null);
    setListMessage(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingDraft("");
    setEditingError(null);
  }

  function handleEdit(event: FormEvent<HTMLFormElement>, note: VideoNote) {
    event.preventDefault();

    const body = editingDraft.trim();
    const validationError = validateDraft(body);

    if (validationError !== null) {
      setEditingError(validationError);
      return;
    }

    setEditingError(null);
    setBusy({ kind: "edit", id: note.id });

    startTransition(async () => {
      try {
        const updated = await editNote(note.id, body);

        if (updated === null) {
          // Another tab deleted it: reflect that instead of pretending to save.
          setNotes((current) => current.filter((item) => item.id !== note.id));
          setEditingId(null);
          setEditingDraft("");
          setListMessage("That note no longer exists.");
          return;
        }

        setNotes((current) => current.map((item) => (item.id === note.id ? updated : item)));
        setEditingId(null);
        setEditingDraft("");
      } catch {
        setEditingError("Could not save your changes. Please try again.");
      } finally {
        setBusy(null);
      }
    });
  }

  function handleDelete(note: VideoNote) {
    setListMessage(null);
    setBusy({ kind: "delete", id: note.id });

    startTransition(async () => {
      try {
        const deleted = await deleteNote(note.id);
        setNotes((current) => current.filter((item) => item.id !== note.id));

        if (editingId === note.id) {
          setEditingId(null);
          setEditingDraft("");
        }

        if (!deleted) {
          setListMessage("That note no longer exists.");
        }
      } catch {
        setListMessage("Could not delete the note. Please try again.");
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div data-slot="watch-notes" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">Your notes</h2>
        <p className="text-xs text-muted-foreground">Private, and stored on this device</p>
      </div>

      <form
        onSubmit={handleAdd}
        aria-label="Add a note"
        aria-busy={busy?.kind === "add"}
        className="flex flex-col gap-2"
      >
        <label htmlFor={draftId} className="text-sm font-medium text-foreground">
          Write a note
        </label>
        <textarea
          id={draftId}
          value={draft}
          rows={3}
          maxLength={MAX_NOTE_BODY_LENGTH}
          placeholder="What do you want to remember about this video?"
          disabled={isBusy}
          aria-invalid={composerError === null ? undefined : true}
          aria-describedby={
            composerError === null ? draftCounterId : `${draftCounterId} ${draftErrorId}`
          }
          onChange={(event) => {
            setDraft(event.target.value);
            if (composerError !== null) {
              setComposerError(null);
            }
          }}
          className="min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={draftCounterId} className="text-xs text-muted-foreground">
            {draftLength} / {MAX_NOTE_BODY_LENGTH}
            <span className="sr-only"> characters</span>
          </p>
          <Button
            type="submit"
            size="lg"
            className="min-h-11"
            disabled={isBusy}
            data-slot="watch-notes-save"
          >
            {busy?.kind === "add" ? "Saving note…" : "Save note"}
          </Button>
        </div>

        {composerError === null ? null : (
          <p id={draftErrorId} role="alert" className="text-sm text-destructive">
            {composerError}
          </p>
        )}
      </form>

      {listMessage === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {listMessage}
        </p>
      )}

      {notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          message="Your notes for this video will appear here. Notes stay on this device."
          icon={<StickyNote aria-hidden="true" className="size-6" />}
          className="px-2"
        />
      ) : (
        <ul role="list" className="flex min-w-0 flex-col divide-y divide-border">
          {notes.map((note) => {
            const created = formatNoteTimestamp(note.createdAt);
            const updated = formatNoteTimestamp(note.updatedAt);
            const wasEdited = note.updatedAt !== note.createdAt;
            const isEditing = editingId === note.id;
            const isDeleting = busy?.kind === "delete" && busy.id === note.id;
            const isSaving = busy?.kind === "edit" && busy.id === note.id;

            return (
              <li
                key={note.id}
                data-slot="watch-note"
                className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0"
              >
                {isEditing ? (
                  <form
                    onSubmit={(event) => handleEdit(event, note)}
                    aria-label={`Edit note from ${created ?? "an unknown date"}`}
                    aria-busy={isSaving}
                    className="flex flex-col gap-2"
                  >
                    <textarea
                      aria-label="Note text"
                      value={editingDraft}
                      rows={3}
                      maxLength={MAX_NOTE_BODY_LENGTH}
                      disabled={isBusy}
                      aria-invalid={editingError === null ? undefined : true}
                      aria-describedby={editingError === null ? undefined : `${note.id}-edit-error`}
                      onChange={(event) => {
                        setEditingDraft(event.target.value);
                        if (editingError !== null) {
                          setEditingError(null);
                        }
                      }}
                      className="min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" className="min-h-11" disabled={isBusy}>
                        {isSaving ? "Saving…" : "Save changes"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={isBusy}
                        onClick={cancelEditing}
                      >
                        Cancel
                      </Button>
                    </div>
                    {editingError === null ? null : (
                      <p
                        id={`${note.id}-edit-error`}
                        role="alert"
                        className="text-sm text-destructive"
                      >
                        {editingError}
                      </p>
                    )}
                  </form>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed break-words whitespace-pre-line text-foreground">
                      {note.body}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="text-xs text-muted-foreground">
                        {created === null ? (
                          "Unknown date"
                        ) : (
                          <time dateTime={note.createdAt}>{created}</time>
                        )}
                        {wasEdited && updated !== null ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>
                              Edited <time dateTime={note.updatedAt}>{updated}</time>
                            </span>
                          </>
                        ) : null}
                      </p>

                      <div
                        role="group"
                        aria-label={`Actions for the note from ${created ?? "an unknown date"}`}
                        className="flex shrink-0 flex-wrap gap-1"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-11"
                          disabled={isBusy}
                          onClick={() => startEditing(note)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          className="min-h-11"
                          disabled={isBusy}
                          onClick={() => handleDelete(note)}
                        >
                          {isDeleting ? "Deleting…" : "Delete"}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Counts code points so an emoji counts as one character, like the validator. */
function countCharacters(value: string): number {
  return Array.from(value).length;
}

/**
 * Client-side mirror of the action's validation, so an obvious mistake is
 * reported without a round trip. The action repeats every rule.
 */
function validateDraft(body: string): string | null {
  if (body.length === 0) {
    return "Write a note before saving.";
  }

  if (countCharacters(body) > MAX_NOTE_BODY_LENGTH) {
    return `Notes can be at most ${MAX_NOTE_BODY_LENGTH} characters.`;
  }

  return null;
}
