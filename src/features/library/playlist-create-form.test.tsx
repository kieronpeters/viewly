import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPlaylistMock } = vi.hoisted(() => ({
  createPlaylistMock: vi.fn(),
}));

vi.mock("./playlist-actions", () => ({
  createPlaylist: createPlaylistMock,
}));

import { PlaylistCreateForm } from "./playlist-create-form";

beforeEach(() => {
  createPlaylistMock.mockReset();
  createPlaylistMock.mockResolvedValue({ playlistId: "playlist-new", name: "Road trip" });
});

describe("PlaylistCreateForm", () => {
  it("creates a playlist from the trimmed name and clears the field", async () => {
    const user = userEvent.setup();

    render(<PlaylistCreateForm />);

    const input = screen.getByLabelText("Playlist name");

    await user.type(input, "  Road trip  ");
    await user.click(screen.getByRole("button", { name: "Create playlist" }));

    await waitFor(() => expect(createPlaylistMock).toHaveBeenCalledWith("Road trip"));
    expect(await screen.findByRole("status")).toHaveTextContent("Created “Road trip”.");
    expect(input).toHaveValue("");
  });

  it("rejects an empty name without calling the action", async () => {
    const user = userEvent.setup();

    render(<PlaylistCreateForm />);

    await user.click(screen.getByRole("button", { name: "Create playlist" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a playlist name.");
    expect(createPlaylistMock).not.toHaveBeenCalled();
  });

  it("marks the field invalid and links the error when the name is empty", async () => {
    const user = userEvent.setup();

    render(<PlaylistCreateForm />);

    const input = screen.getByLabelText("Playlist name");

    await user.click(screen.getByRole("button", { name: "Create playlist" }));

    const alert = await screen.findByRole("alert");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(createPlaylistMock).not.toHaveBeenCalled();
  });

  it("keeps the typed name and reports a failed create", async () => {
    const user = userEvent.setup();

    createPlaylistMock.mockRejectedValue(new Error("database"));

    render(<PlaylistCreateForm />);

    const input = screen.getByLabelText("Playlist name");
    await user.type(input, "Road trip");
    await user.click(screen.getByRole("button", { name: "Create playlist" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the playlist. Please try again.",
    );
    expect(input).toHaveValue("Road trip");
  });
});
