import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addNoteMock, editNoteMock, deleteNoteMock } = vi.hoisted(() => ({
  addNoteMock: vi.fn(),
  editNoteMock: vi.fn(),
  deleteNoteMock: vi.fn(),
}));

// The panel is a client component over Server Actions; stub the actions so the
// tests assert the UI contract without a Next server or a database.
vi.mock("@/features/notes/actions", () => ({
  addNote: addNoteMock,
  editNote: editNoteMock,
  deleteNote: deleteNoteMock,
}));

import { PlayerSeekProvider, usePlayerSeek } from "@/components/video/player-seek";
import type { PlayerClock } from "@/components/video/player-seek";
import type { VideoNote } from "@/features/notes/notes";
import { MAX_NOTE_BODY_LENGTH } from "@/shared/validation";

import { WatchNotes } from "./watch-notes";

const VIDEO_ID = "dQw4w9WgXcQ";

/** A note created and never edited. */
const NEWEST: VideoNote = {
  id: "note-newest",
  videoId: VIDEO_ID,
  body: "The middle section is worth rewatching.",
  startSeconds: null,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
};

/** An older note that has been edited. */
const OLDER: VideoNote = {
  id: "note-older",
  videoId: VIDEO_ID,
  body: "Check the source links in the description.",
  startSeconds: null,
  createdAt: "2026-11-09T08:30:00.000Z",
  updatedAt: "2026-11-09T09:15:00.000Z",
};

/** A highlight anchored at 1:23. */
const HIGHLIGHT_LATE: VideoNote = {
  id: "highlight-late",
  videoId: VIDEO_ID,
  body: "The example starts here.",
  startSeconds: 83,
  createdAt: "2026-11-10T13:00:00.000Z",
  updatedAt: "2026-11-10T13:00:00.000Z",
};

/** A highlight anchored at 0:30, created after the later one. */
const HIGHLIGHT_EARLY: VideoNote = {
  id: "highlight-early",
  videoId: VIDEO_ID,
  body: "Setup ends here.",
  startSeconds: 30,
  createdAt: "2026-11-10T14:00:00.000Z",
  updatedAt: "2026-11-10T14:00:00.000Z",
};

beforeEach(() => {
  addNoteMock.mockReset();
  editNoteMock.mockReset();
  deleteNoteMock.mockReset();
});

function renderPanel(initialNotes: readonly VideoNote[] = []) {
  return render(<WatchNotes videoId={VIDEO_ID} initialNotes={initialNotes} />);
}

/**
 * Renders the panel with a fake player registered on the shared channel, so
 * the tests assert the T71 seek wiring and the T90 clock read without jsdom
 * needing the real YouTube API.
 */
function renderPanelWithPlayer(initialNotes: readonly VideoNote[], clock: PlayerClock | null) {
  const seekTo = vi.fn();

  function FakePlayer() {
    const playerSeek = usePlayerSeek();

    useEffect(() => {
      if (playerSeek === null) {
        return;
      }

      const unregisterSeek = playerSeek.registerSeekTarget(seekTo);
      const unregisterClock = playerSeek.registerClockSource(() => clock);

      return () => {
        unregisterSeek();
        unregisterClock();
      };
    }, [playerSeek]);

    return null;
  }

  return {
    seekTo,
    ...render(
      <PlayerSeekProvider>
        <FakePlayer />
        <WatchNotes videoId={VIDEO_ID} initialNotes={initialNotes} />
      </PlayerSeekProvider>,
    ),
  };
}

/** The per-note action group, addressed by its created timestamp. */
function actionsFor(created: string): HTMLElement {
  return screen.getByRole("group", { name: `Actions for the note from ${created}` });
}

function noteTextarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Write a note" });
}

describe("WatchNotes", () => {
  it("shows the composer and the authored empty state when there are no notes", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Your notes" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Write a note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save note" })).toBeInTheDocument();
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
    expect(screen.getByText(/notes stay on this device/i)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists notes newest first with created and edited timestamps", () => {
    renderPanel([NEWEST, OLDER]);

    const items = screen.getAllByRole("listitem");

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(NEWEST.body);
    expect(items[1]).toHaveTextContent(OLDER.body);

    expect(within(items[0]).getByText("10 Nov 2026, 12:00")).toBeInTheDocument();
    expect(within(items[1]).getByText("9 Nov 2026, 08:30")).toBeInTheDocument();
    expect(within(items[1]).getByText(/Edited/)).toHaveTextContent("Edited 9 Nov 2026, 09:15");

    // The never-edited note has no "Edited" marker.
    expect(within(items[0]).queryByText(/Edited/)).not.toBeInTheDocument();

    expect(within(items[0]).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(items[0]).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("saves a trimmed note, prepends it and clears the composer", async () => {
    const user = userEvent.setup();
    const saved: VideoNote = {
      ...NEWEST,
      id: "note-saved",
      body: "Remember to pause at the map.",
      createdAt: "2026-11-10T13:00:00.000Z",
      updatedAt: "2026-11-10T13:00:00.000Z",
    };
    addNoteMock.mockResolvedValue(saved);

    renderPanel([NEWEST]);

    await user.type(noteTextarea(), "  Remember to pause at the map.  ");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(addNoteMock).toHaveBeenCalledWith(VIDEO_ID, "Remember to pause at the map.");
    expect(await screen.findByText("Remember to pause at the map.")).toBeInTheDocument();
    expect(noteTextarea()).toHaveValue("");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Remember to pause at the map.");
  });

  it("shows the saving state and disables the composer while the action is in flight", async () => {
    const user = userEvent.setup();
    let resolveAdd: (note: VideoNote) => void = () => {};
    addNoteMock.mockReturnValue(
      new Promise<VideoNote>((resolve) => {
        resolveAdd = resolve;
      }),
    );

    renderPanel();

    await user.type(noteTextarea(), "Slow note");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(screen.getByRole("button", { name: "Saving note…" })).toBeDisabled();
    expect(noteTextarea()).toBeDisabled();

    await act(async () => {
      resolveAdd({ ...NEWEST, id: "note-slow", body: "Slow note" });
    });

    expect(await screen.findByText("Slow note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save note" })).toBeEnabled();
  });

  it("refuses an empty draft without calling the action", async () => {
    const user = userEvent.setup();

    renderPanel();

    await user.type(noteTextarea(), "   ");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Write a note before saving.");
    expect(addNoteMock).not.toHaveBeenCalled();
    expect(noteTextarea()).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the draft and explains an action failure", async () => {
    const user = userEvent.setup();
    addNoteMock.mockRejectedValue(new Error("database is locked"));

    renderPanel();

    await user.type(noteTextarea(), "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save your note. Please try again.",
    );
    expect(noteTextarea()).toHaveValue("Keep this draft");
  });

  it("edits a note in place and shows the new edited timestamp", async () => {
    const user = userEvent.setup();
    const updated: VideoNote = {
      ...OLDER,
      body: "Revised guidance.",
      updatedAt: "2026-11-10T14:00:00.000Z",
    };
    editNoteMock.mockResolvedValue(updated);

    renderPanel([OLDER]);

    await user.click(within(actionsFor("9 Nov 2026, 08:30")).getByRole("button", { name: "Edit" }));

    const editor = screen.getByRole("textbox", { name: "Note text" });
    expect(editor).toHaveValue(OLDER.body);

    await user.clear(editor);
    await user.type(editor, "Revised guidance.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(editNoteMock).toHaveBeenCalledWith(OLDER.id, "Revised guidance.");
    expect(await screen.findByText("Revised guidance.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note text" })).not.toBeInTheDocument();
    expect(screen.getByText(/Edited/)).toHaveTextContent("Edited 10 Nov 2026, 14:00");
  });

  it("cancels an edit without calling the action", async () => {
    const user = userEvent.setup();

    renderPanel([OLDER]);

    await user.click(within(actionsFor("9 Nov 2026, 08:30")).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Note text" })).not.toBeInTheDocument();
    expect(screen.getByText(OLDER.body)).toBeInTheDocument();
    expect(editNoteMock).not.toHaveBeenCalled();
  });

  it("deletes a note and falls back to the empty state", async () => {
    const user = userEvent.setup();
    deleteNoteMock.mockResolvedValue(true);

    renderPanel([OLDER]);

    await user.click(
      within(actionsFor("9 Nov 2026, 08:30")).getByRole("button", { name: "Delete" }),
    );

    expect(deleteNoteMock).toHaveBeenCalledWith(OLDER.id);
    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
    expect(screen.queryByText(OLDER.body)).not.toBeInTheDocument();
  });

  it("drops a note that another tab already deleted and says so", async () => {
    const user = userEvent.setup();
    deleteNoteMock.mockResolvedValue(false);
    editNoteMock.mockResolvedValue(null);

    renderPanel([NEWEST]);

    await user.click(
      within(actionsFor("10 Nov 2026, 12:00")).getByRole("button", { name: "Delete" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("That note no longer exists.");
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });

  it("replaces the note body with the returned row, not with the typed text", async () => {
    const user = userEvent.setup();
    // The action normalizes the body (for example, it trims) — the panel must
    // render what was stored, not the optimistic draft.
    editNoteMock.mockResolvedValue({ ...OLDER, body: "Stored body" });

    renderPanel([OLDER]);

    await user.click(within(actionsFor("9 Nov 2026, 08:30")).getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Note text" }));
    await user.type(screen.getByRole("textbox", { name: "Note text" }), "Typed body");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Stored body")).toBeInTheDocument();
    expect(screen.queryByText("Typed body")).not.toBeInTheDocument();
  });

  it("shows the character budget for the 2000-character limit", async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(screen.getByText(`0 / ${MAX_NOTE_BODY_LENGTH}`, { exact: false })).toBeInTheDocument();

    await user.type(noteTextarea(), "abcd");

    expect(screen.getByText(`4 / ${MAX_NOTE_BODY_LENGTH}`, { exact: false })).toBeInTheDocument();
  });

  it("keeps free-text notes and highlights in separate lists", () => {
    renderPanel([HIGHLIGHT_LATE, OLDER, HIGHLIGHT_EARLY, NEWEST]);

    const notes = within(screen.getByRole("list", { name: "Notes" })).getAllByRole("listitem");
    const highlights = within(screen.getByRole("list", { name: "Highlights" })).getAllByRole(
      "listitem",
    );

    expect(notes.map((item) => item.textContent)).toEqual([
      expect.stringContaining(OLDER.body),
      expect.stringContaining(NEWEST.body),
    ]);
    expect(highlights.map((item) => item.textContent)).toEqual([
      expect.stringContaining(HIGHLIGHT_EARLY.body),
      expect.stringContaining(HIGHLIGHT_LATE.body),
    ]);
  });

  it("renders a timestamp button for highlights and no timestamp for plain notes", () => {
    renderPanel([HIGHLIGHT_LATE, NEWEST]);

    const notes = within(screen.getByRole("list", { name: "Notes" })).getAllByRole("listitem");

    expect(screen.getByRole("button", { name: "Seek to 1:23" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Seek to/ })).toHaveLength(1);
    expect(within(notes[0]!).queryByRole("button", { name: /^Seek to/ })).not.toBeInTheDocument();
  });

  it("seeks the official player through the shared channel when a timestamp is clicked", async () => {
    const user = userEvent.setup();
    const { seekTo } = renderPanelWithPlayer([HIGHLIGHT_LATE], null);

    await user.click(screen.getByRole("button", { name: "Seek to 1:23" }));

    expect(seekTo).toHaveBeenCalledWith(83);
  });

  it("captures the current time and saves a highlight through the action", async () => {
    const user = userEvent.setup();
    addNoteMock.mockResolvedValue({
      ...HIGHLIGHT_LATE,
      id: "highlight-saved",
      body: "Anchor this moment.",
    });

    renderPanelWithPlayer([], { positionSeconds: 83.9, durationSeconds: 213 });

    await user.click(screen.getByRole("button", { name: "Save note at current time" }));

    expect(screen.getByRole("status")).toHaveTextContent("Highlight at 1:23");
    expect(screen.getByRole("button", { name: "Save highlight at 1:23" })).toBeInTheDocument();

    await user.type(noteTextarea(), "  Anchor this moment.  ");
    await user.click(screen.getByRole("button", { name: "Save highlight at 1:23" }));

    expect(addNoteMock).toHaveBeenCalledWith(VIDEO_ID, "Anchor this moment.", {
      startSeconds: 83,
      durationSeconds: 213,
    });

    const highlights = within(screen.getByRole("list", { name: "Highlights" })).getAllByRole(
      "listitem",
    );
    expect(highlights[0]).toHaveTextContent("Anchor this moment.");
    expect(
      within(highlights[0]!).getByRole("button", { name: "Seek to 1:23" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains that a position cannot be captured before the player is ready", async () => {
    const user = userEvent.setup();

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Save note at current time" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Start the video, then save a note at the current time.",
    );
    expect(addNoteMock).not.toHaveBeenCalled();
  });

  it("lets the viewer remove a captured timestamp before saving", async () => {
    const user = userEvent.setup();
    addNoteMock.mockResolvedValue({ ...NEWEST, id: "note-plain", body: "Plain again" });

    renderPanelWithPlayer([], { positionSeconds: 83, durationSeconds: 213 });

    await user.click(screen.getByRole("button", { name: "Save note at current time" }));
    await user.click(screen.getByRole("button", { name: "Remove timestamp" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save note" })).toBeInTheDocument();

    await user.type(noteTextarea(), "Plain again");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(addNoteMock).toHaveBeenCalledWith(VIDEO_ID, "Plain again");
  });

  it("edits a highlight in place and keeps it in playback order", async () => {
    const user = userEvent.setup();
    const revised = {
      ...HIGHLIGHT_EARLY,
      body: "Revised setup.",
      updatedAt: "2026-11-10T15:00:00.000Z",
    };
    editNoteMock.mockResolvedValue(revised);

    renderPanel([HIGHLIGHT_LATE, HIGHLIGHT_EARLY]);

    await user.click(
      within(actionsFor("10 Nov 2026, 14:00")).getByRole("button", { name: "Edit" }),
    );

    const editor = screen.getByRole("textbox", { name: "Note text" });
    expect(editor).toHaveValue(HIGHLIGHT_EARLY.body);

    await user.clear(editor);
    await user.type(editor, "Revised setup.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(editNoteMock).toHaveBeenCalledWith(HIGHLIGHT_EARLY.id, "Revised setup.");

    const highlights = within(screen.getByRole("list", { name: "Highlights" })).getAllByRole(
      "listitem",
    );
    expect(highlights.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Revised setup."),
      expect.stringContaining(HIGHLIGHT_LATE.body),
    ]);
    expect(within(highlights[0]!).getByText(/Edited/)).toHaveTextContent(
      "Edited 10 Nov 2026, 15:00",
    );
  });

  it("deletes a highlight and leaves the other notes alone", async () => {
    const user = userEvent.setup();
    deleteNoteMock.mockResolvedValue(true);

    renderPanel([HIGHLIGHT_LATE, NEWEST]);

    await user.click(
      within(actionsFor("10 Nov 2026, 13:00")).getByRole("button", { name: "Delete" }),
    );

    expect(deleteNoteMock).toHaveBeenCalledWith(HIGHLIGHT_LATE.id);
    expect(screen.queryByText(HIGHLIGHT_LATE.body)).not.toBeInTheDocument();
    expect(screen.getByText(NEWEST.body)).toBeInTheDocument();
    expect(
      screen.getByText("No highlights yet. Save a note at the current time while watching."),
    ).toBeInTheDocument();
  });
});
