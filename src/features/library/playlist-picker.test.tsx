import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addToPlaylistMock, createPlaylistMock } = vi.hoisted(() => ({
  addToPlaylistMock: vi.fn(),
  createPlaylistMock: vi.fn(),
}));

vi.mock("./playlist-actions", () => ({
  addToPlaylist: addToPlaylistMock,
  createPlaylist: createPlaylistMock,
}));

import { PlaylistPicker } from "./playlist-picker";
import type { PlaylistSnapshot } from "./playlists";

const VIDEO: PlaylistSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

const PLAYLISTS = [
  { id: "playlist-road-trip", name: "Road trip" },
  { id: "playlist-lofi", name: "Lofi beats" },
];

beforeEach(() => {
  addToPlaylistMock.mockReset();
  addToPlaylistMock.mockResolvedValue({
    added: true,
    playlistId: "playlist-road-trip",
    videoId: VIDEO.videoId,
  });
  createPlaylistMock.mockReset();
});

describe("PlaylistPicker", () => {
  it("starts closed and exposes its expanded state on the trigger", () => {
    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    const trigger = screen.getByRole("button", { name: "Add to playlist" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The panel is not rendered, so there is no element for aria-controls to
    // reference; a dangling id would be an invalid relationship.
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("group", { name: "Add to playlist" })).not.toBeInTheDocument();
  });

  it("points aria-controls at the panel only while it exists", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    const trigger = screen.getByRole("button", { name: "Add to playlist" });

    await user.click(trigger);

    const panel = screen.getByRole("group", { name: "Add to playlist" });
    const controls = trigger.getAttribute("aria-controls");

    expect(controls).toBeTruthy();
    expect(panel).toHaveAttribute("id", controls as string);
    // The reference resolves to a real element in the document.
    expect(document.getElementById(controls as string)).toBe(panel);

    await user.keyboard("{Escape}");

    expect(trigger).not.toHaveAttribute("aria-controls");
  });

  it("opens inline, lists every playlist and focuses the first action", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));

    const panel = screen.getByRole("group", { name: "Add to playlist" });

    expect(screen.getByRole("button", { name: "Add to playlist" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(panel).getByRole("button", { name: "Road trip" })).toHaveFocus();
    expect(within(panel).getByRole("button", { name: "Lofi beats" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "New playlist" })).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    const trigger = screen.getByRole("button", { name: "Add to playlist" });
    await user.click(trigger);

    fireEvent.keyDown(screen.getByRole("group", { name: "Add to playlist" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("group", { name: "Add to playlist" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("bounds the panel to the viewport and keeps its options tappable", async () => {
    // The panel is right-aligned to its trigger, which can sit near the left of
    // a 360px screen once the watch header stacks. The viewport cap is what
    // stops it from hanging off-screen; jsdom cannot measure it, so the guard
    // is the class itself plus the 44px option height.
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));

    const panel = screen.getByRole("group", { name: "Add to playlist" });

    expect(panel).toHaveClass("w-60", "max-w-[calc(100vw_-_2rem)]");
    expect(within(panel).getByRole("button", { name: "Road trip" })).toHaveClass("min-h-11");
    expect(within(panel).getByRole("button", { name: "New playlist" })).toHaveClass("min-h-11");
  });

  it("adds the video to a playlist and announces the result", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "Road trip" }));

    await waitFor(() => {
      expect(addToPlaylistMock).toHaveBeenCalledWith("playlist-road-trip", VIDEO);
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Added to Road trip.");
    expect(screen.queryByRole("group", { name: "Add to playlist" })).not.toBeInTheDocument();
  });

  it("creates a playlist and immediately adds the video", async () => {
    const user = userEvent.setup();

    createPlaylistMock.mockResolvedValue({ playlistId: "playlist-new", name: "Chill" });

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "New playlist" }));
    await user.type(screen.getByLabelText("New playlist name"), "  Chill  ");
    await user.click(screen.getByRole("button", { name: "Create and add" }));

    await waitFor(() => {
      expect(createPlaylistMock).toHaveBeenCalledWith("Chill");
    });
    expect(addToPlaylistMock).toHaveBeenCalledWith("playlist-new", VIDEO);
    expect(await screen.findByRole("status")).toHaveTextContent("Added to Chill.");

    // The new option is available on the next open without a reload.
    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    expect(screen.getByRole("button", { name: "Chill" })).toBeInTheDocument();
  });

  it("rejects an empty playlist name before calling the action", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "New playlist" }));

    const field = screen.getByLabelText("New playlist name");

    await user.click(screen.getByRole("button", { name: "Create and add" }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Enter a playlist name.");
    // The field is marked invalid and the alert is its description.
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", alert.id);
    expect(createPlaylistMock).not.toHaveBeenCalled();
    expect(addToPlaylistMock).not.toHaveBeenCalled();
  });

  it("reports a stale playlist without closing the panel", async () => {
    const user = userEvent.setup();

    addToPlaylistMock.mockResolvedValue({
      added: false,
      playlistId: "playlist-road-trip",
      videoId: VIDEO.videoId,
    });

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "Road trip" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That playlist no longer exists.");
    expect(screen.getByRole("group", { name: "Add to playlist" })).toBeInTheDocument();
  });

  it("keeps a newly created playlist selectable when the add fails", async () => {
    const user = userEvent.setup();

    createPlaylistMock.mockResolvedValue({ playlistId: "playlist-new", name: "Chill" });
    addToPlaylistMock.mockResolvedValue({
      added: false,
      playlistId: "playlist-new",
      videoId: VIDEO.videoId,
    });

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "New playlist" }));
    await user.type(screen.getByLabelText("New playlist name"), "Chill");
    await user.click(screen.getByRole("button", { name: "Create and add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The playlist was created, but the video could not be added.",
    );
    expect(screen.getByRole("button", { name: "Chill" })).toBeInTheDocument();
  });

  it("shows an alert when the add fails", async () => {
    const user = userEvent.setup();

    addToPlaylistMock.mockRejectedValue(new Error("network"));

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "Road trip" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not add to playlist. Please try again.",
    );
  });

  it("offers the new-playlist path even when there are no playlists yet", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={[]} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));

    expect(screen.getByText("No playlists yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New playlist" })).toBeInTheDocument();
  });

  it("opens from the keyboard and closes again with Escape", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.tab();
    const trigger = screen.getByRole("button", { name: "Add to playlist" });
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Road trip" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "Add to playlist" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the trigger is pressed a second time", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    const trigger = screen.getByRole("button", { name: "Add to playlist" });
    await user.click(trigger);
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Add to playlist" })).not.toBeInTheDocument();
  });

  it("closes when the user clicks outside the control", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    expect(screen.getByRole("group", { name: "Add to playlist" })).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByRole("group", { name: "Add to playlist" })).not.toBeInTheDocument();
  });

  it("closes the create form with Escape from the name field", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "New playlist" }));

    const nameField = screen.getByLabelText("New playlist name");
    await user.type(nameField, "Chill");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "Add to playlist" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to playlist" })).toHaveFocus();
    expect(createPlaylistMock).not.toHaveBeenCalled();
  });

  it("returns to the list when the create form is cancelled", async () => {
    const user = userEvent.setup();

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "New playlist" }));
    await user.type(screen.getByLabelText("New playlist name"), "Chill");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("New playlist name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Road trip" })).toBeInTheDocument();
    expect(createPlaylistMock).not.toHaveBeenCalled();
    expect(addToPlaylistMock).not.toHaveBeenCalled();
  });

  it("reports a failed create and keeps the form open for a retry", async () => {
    const user = userEvent.setup();

    createPlaylistMock.mockRejectedValue(new Error("database unavailable"));

    render(<PlaylistPicker video={VIDEO} playlists={PLAYLISTS} />);

    await user.click(screen.getByRole("button", { name: "Add to playlist" }));
    await user.click(screen.getByRole("button", { name: "New playlist" }));
    await user.type(screen.getByLabelText("New playlist name"), "Chill");
    await user.click(screen.getByRole("button", { name: "Create and add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the playlist. Please try again.",
    );
    expect(screen.getByLabelText("New playlist name")).toBeInTheDocument();
    expect(addToPlaylistMock).not.toHaveBeenCalled();
  });
});
