"use client";

import { StickyNote } from "lucide-react";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { usePlayerSeek } from "@/components/video/player-seek";
import { addNote, deleteNote, editNote } from "@/features/notes/actions";
import {
  formatNoteTimestamp,
  partitionVideoNotes,
  type NotePosition,
  type VideoNote,
} from "@/features/notes/notes";
import { formatDuration } from "@/shared/format";
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
 * Local notes and timestamped highlights for the watch page's "Your notes" tab
 * (T79, extended by T90).
 *
 * Notes are a private scratchpad stored in SQLite: no account, no YouTube
 * comment and no request of their own. The server reads the list once and
 * passes it in, so the panel renders its real content on hydration; the
 * composer and the inline editor then apply each action's returned row to the
 * local list, with the action's `revalidatePath` keeping the server render in
 * step.
 *
 * ## Notes and highlights
 *
 * The panel renders one table as two lists:
 *
 * - **Notes** — rows without a timestamp, newest first, exactly the T79
 *   behaviour.
 * - **Highlights** — rows with a `startSeconds`, ordered by playback time.
 *   Each timestamp is a button that seeks the official player through the
 *   shared T71 channel, so it reuses the same handle as a description
 *   timestamp. Edit and delete are the same actions as for a note.
 *
 * "Save note at current time" samples the player's playhead through that same
 * channel and attaches it to the next save. If no player is ready yet, the
 * panel explains that instead of saving a bogus anchor. Capturing a timestamp
 * does not submit anything: the viewer can still write or revise the body.
 *
 * States the UI distinguishes:
 *
 * - empty: an authored "No notes yet" placeholder under the composer;
 * - ready: untimed notes newest first and highlights in playback order, each
 *   with a created timestamp and, after an edit, an "Edited" timestamp;
 * - composing/editing/saving: the relevant controls are disabled while the
 *   action is in flight;
 * - validation failure: the draft is kept and an inline `role="alert"`
 *   explains what to fix;
 * - action failure: an inline `role="alert"` above the lists, with the lists
 *   left intact so nothing is lost.
 *
 * Bodies are rendered as React text nodes with `whitespace-pre-line`, never as
 * HTML.
 */
export function WatchNotes({ videoId, initialNotes }: WatchNotesProps) {
  const [notes, setNotes] = useState<VideoNote[]>(() => [...initialNotes]);
  const [draft, setDraft] = useState("");
  const [draftPosition, setDraftPosition] = useState<NotePosition | null>(null);
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
  const notesHeadingId = useId();
  const highlightsHeadingId = useId();

  const playerSeek = usePlayerSeek();
  const { notes: untimedNotes, highlights } = useMemo(() => partitionVideoNotes(notes), [notes]);
  const isBusy = busy !== null || isPending;
  const draftLength = countCharacters(draft);
  const draftPositionLabel =
    draftPosition === null ? null : formatDuration(draftPosition.startSeconds);

  /**
   * Samples the player through the shared T71 channel and remembers the
   * position for the next save. A missing player is a recoverable UI state, not
   * an error: the video simply has not started yet.
   */
  function handleCaptureCurrentTime() {
    setListMessage(null);

    const clock = playerSeek?.getPlaybackClock() ?? null;

    if (clock === null || !Number.isFinite(clock.positionSeconds)) {
      setComposerError("Start the video, then save a note at the current time.");
      return;
    }

    const startSeconds = Math.max(0, Math.floor(clock.positionSeconds));
    const durationSeconds = Number.isFinite(clock.durationSeconds)
      ? Math.max(0, Math.floor(clock.durationSeconds))
      : 0;

    if (durationSeconds > 0 && startSeconds > durationSeconds) {
      setComposerError("Could not read the playback position. Please try again.");
      return;
    }

    setComposerError(null);
    setDraftPosition({ startSeconds, durationSeconds });
  }

  function clearCapturedPosition() {
    setDraftPosition(null);
    setComposerError(null);
  }

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
        const note =
          draftPosition === null
            ? await addNote(videoId, body)
            : await addNote(videoId, body, draftPosition);

        setNotes((current) => [note, ...current]);
        setDraft("");
        setDraftPosition(null);
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

  /** Seek the official player; an absent provider leaves the button inert. */
  function handleSeek(seconds: number) {
    playerSeek?.seekTo(seconds);
  }

  function renderNote(note: VideoNote, variant: "note" | "highlight") {
    return (
      <NoteListItem
        key={note.id}
        note={note}
        variant={variant}
        isEditing={editingId === note.id}
        editingDraft={editingDraft}
        editingError={editingError}
        busy={busy}
        isBusy={isBusy}
        onStartEditing={startEditing}
        onCancelEditing={cancelEditing}
        onEdit={handleEdit}
        onEditingDraftChange={(value) => {
          setEditingDraft(value);
          if (editingError !== null) {
            setEditingError(null);
          }
        }}
        onDelete={handleDelete}
        onSeek={handleSeek}
      />
    );
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-11"
              disabled={isBusy}
              aria-pressed={draftPosition !== null}
              onClick={handleCaptureCurrentTime}
              data-slot="watch-notes-capture"
            >
              {draftPosition === null ? "Save note at current time" : "Update to current time"}
            </Button>
            <Button
              type="submit"
              size="lg"
              className="min-h-11"
              disabled={isBusy}
              data-slot="watch-notes-save"
            >
              {busy?.kind === "add"
                ? "Saving note…"
                : draftPositionLabel === null
                  ? "Save note"
                  : `Save highlight at ${draftPositionLabel}`}
            </Button>
          </div>
        </div>

        {draftPosition === null ? null : (
          <p
            role="status"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <span>
              Highlight at{" "}
              <span className="tabular-nums text-foreground">{draftPositionLabel}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={isBusy}
              onClick={clearCapturedPosition}
            >
              Remove timestamp
            </Button>
          </p>
        )}

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
        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-labelledby={notesHeadingId}
            data-slot="watch-note-list"
            className="flex min-w-0 flex-col gap-2"
          >
            <h3 id={notesHeadingId} className="text-sm font-semibold text-foreground">
              Notes
            </h3>
            {untimedNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No notes yet. Write one above, or save a highlight at the current time.
              </p>
            ) : (
              <ul
                role="list"
                aria-label="Notes"
                className="flex min-w-0 flex-col divide-y divide-border"
              >
                {untimedNotes.map((note) => renderNote(note, "note"))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby={highlightsHeadingId}
            data-slot="watch-highlight-list"
            className="flex min-w-0 flex-col gap-2"
          >
            <h3 id={highlightsHeadingId} className="text-sm font-semibold text-foreground">
              Highlights
            </h3>
            {highlights.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No highlights yet. Save a note at the current time while watching.
              </p>
            ) : (
              <ol
                role="list"
                aria-label="Highlights"
                className="flex min-w-0 flex-col divide-y divide-border"
              >
                {highlights.map((note) => renderNote(note, "highlight"))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

interface NoteListItemProps {
  readonly note: VideoNote;
  readonly variant: "note" | "highlight";
  readonly isEditing: boolean;
  readonly editingDraft: string;
  readonly editingError: string | null;
  readonly busy: BusyState;
  readonly isBusy: boolean;
  readonly onStartEditing: (note: VideoNote) => void;
  readonly onCancelEditing: () => void;
  readonly onEdit: (event: FormEvent<HTMLFormElement>, note: VideoNote) => void;
  readonly onEditingDraftChange: (value: string) => void;
  readonly onDelete: (note: VideoNote) => void;
  readonly onSeek: (seconds: number) => void;
}

/** One note or highlight, with its inline editor and actions. */
function NoteListItem({
  note,
  variant,
  isEditing,
  editingDraft,
  editingError,
  busy,
  isBusy,
  onStartEditing,
  onCancelEditing,
  onEdit,
  onEditingDraftChange,
  onDelete,
  onSeek,
}: NoteListItemProps) {
  const created = formatNoteTimestamp(note.createdAt);
  const updated = formatNoteTimestamp(note.updatedAt);
  const wasEdited = note.updatedAt !== note.createdAt;
  const startLabel = note.startSeconds === null ? null : formatDuration(note.startSeconds);
  const isDeleting = busy?.kind === "delete" && busy.id === note.id;
  const isSaving = busy?.kind === "edit" && busy.id === note.id;
  const actionLabel = `Actions for the note from ${created ?? "an unknown date"}`;

  return (
    <li
      data-slot={variant === "highlight" ? "watch-highlight" : "watch-note"}
      className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0"
    >
      {isEditing ? (
        <form
          onSubmit={(event) => onEdit(event, note)}
          aria-label={`Edit note from ${created ?? "an unknown date"}`}
          aria-busy={isSaving}
          className="flex flex-col gap-2"
        >
          {startLabel === null ? null : (
            <p className="text-xs text-muted-foreground">
              Highlight at <span className="tabular-nums text-foreground">{startLabel}</span>
            </p>
          )}
          <textarea
            aria-label="Note text"
            value={editingDraft}
            rows={3}
            maxLength={MAX_NOTE_BODY_LENGTH}
            disabled={isBusy}
            aria-invalid={editingError === null ? undefined : true}
            aria-describedby={editingError === null ? undefined : `${note.id}-edit-error`}
            onChange={(event) => onEditingDraftChange(event.target.value)}
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
              onClick={onCancelEditing}
            >
              Cancel
            </Button>
          </div>
          {editingError === null ? null : (
            <p id={`${note.id}-edit-error`} role="alert" className="text-sm text-destructive">
              {editingError}
            </p>
          )}
        </form>
      ) : (
        <>
          {variant === "highlight" && startLabel !== null && note.startSeconds !== null ? (
            <button
              type="button"
              aria-label={`Seek to ${startLabel}`}
              data-seconds={note.startSeconds}
              onClick={() => onSeek(note.startSeconds ?? 0)}
              className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-sm border-0 bg-transparent p-0 text-sm tabular-nums text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {startLabel}
            </button>
          ) : null}

          <p className="text-sm leading-relaxed break-words whitespace-pre-line text-foreground">
            {note.body}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-xs text-muted-foreground">
              {created === null ? "Unknown date" : <time dateTime={note.createdAt}>{created}</time>}
              {wasEdited && updated !== null ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>
                    Edited <time dateTime={note.updatedAt}>{updated}</time>
                  </span>
                </>
              ) : null}
            </p>

            <div role="group" aria-label={actionLabel} className="flex shrink-0 flex-wrap gap-1">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={isBusy}
                onClick={() => onStartEditing(note)}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="min-h-11"
                disabled={isBusy}
                onClick={() => onDelete(note)}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </>
      )}
    </li>
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
