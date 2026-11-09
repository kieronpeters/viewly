import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getPlaylistForPageMock,
  getVideosMock,
  notFoundMock,
  pushMock,
  removeFromPlaylistMock,
  renamePlaylistMock,
  deletePlaylistMock,
} = vi.hoisted(() => ({
  getPlaylistForPageMock: vi.fn(),
  getVideosMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  pushMock: vi.fn(),
  removeFromPlaylistMock: vi.fn(),
  renamePlaylistMock: vi.fn(),
  deletePlaylistMock: vi.fn(),
}));

// The page reads through the server-only barrel; replace it so no database is
// opened. YouTube metadata is a single `getVideos` batch, stubbed per test.
vi.mock("@/features/library", () => ({
  getPlaylistForPage: getPlaylistForPageMock,
}));
vi.mock("@/lib/youtube/client", () => ({ getVideos: getVideosMock }));
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));
vi.mock("@/features/library/playlist-actions", () => ({
  createPlaylist: vi.fn(),
  renamePlaylist: renamePlaylistMock,
  deletePlaylist: deletePlaylistMock,
  addToPlaylist: vi.fn(),
  removeFromPlaylist: removeFromPlaylistMock,
}));
// Next's real notFound() throws a control-flow error Next catches; mirror it.
vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  useRouter: () => ({ push: pushMock }),
}));

import type { PlaylistPageData } from "@/features/library";
import type { VideoSummary } from "@/shared/types";

import { PlaylistPageContent } from "./playlist-page-content";

const PLAYLIST: PlaylistPageData = {
  id: "playlist-road-trip",
  name: "Road trip",
  videoIds: ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"],
};

/** A normalized `videos.list` item for one of the stored ids. */
function video(id: string, title: string): VideoSummary {
  return {
    id,
    title,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Channel",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_000,
  };
}

function paramsFor(playlistId: string): Promise<{ playlistId: string }> {
  return Promise.resolve({ playlistId });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPlaylistForPageMock.mockReset();
  getPlaylistForPageMock.mockReturnValue(PLAYLIST);
  getVideosMock.mockReset();
  getVideosMock.mockResolvedValue([
    video("aaaaaaaaaaa", "First video"),
    video("ccccccccccc", "Third video"),
  ]);
  removeFromPlaylistMock.mockReset();
  removeFromPlaylistMock.mockResolvedValue({ removed: true });
  renamePlaylistMock.mockReset();
  renamePlaylistMock.mockResolvedValue({ renamed: true, name: "New name" });
  deletePlaylistMock.mockReset();
  deletePlaylistMock.mockResolvedValue({ deleted: true });
});

describe("PlaylistPageContent", () => {
  it("renders the name and the videos in playlist order", async () => {
    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    expect(screen.getByRole("heading", { level: 1, name: "Road trip" })).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/watch/aaaaaaaaaaa",
      "/watch/ccccccccccc",
    ]);
    expect(screen.getByText("3 videos, in playlist order.")).toBeInTheDocument();
    expect(getPlaylistForPageMock).toHaveBeenCalledWith(PLAYLIST.id);
    expect(getVideosMock).toHaveBeenCalledTimes(1);
    expect(getVideosMock).toHaveBeenCalledWith(PLAYLIST.videoIds);
  });

  it("keeps heading order at h1 → h2 → h3 above the playlist videos", async () => {
    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    expect(screen.getAllByRole("heading").map((heading) => heading.tagName)).toEqual([
      "H1",
      "H2",
      "H3",
      "H3",
    ]);
    expect(
      screen.getByRole("heading", { level: 2, name: "Videos in Road trip" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Videos in Road trip" })).toBeInTheDocument();
  });

  it("renders an unavailable row with the stored id when metadata is missing", async () => {
    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    const unavailable = screen
      .getByText("Unavailable video")
      .closest('[data-slot="playlist-unavailable"]');

    expect(unavailable).not.toBeNull();
    expect(within(unavailable as HTMLElement).getByText("bbbbbbbbbbb")).toBeInTheDocument();
    expect(
      within(unavailable as HTMLElement).getByRole("button", {
        name: "Remove unavailable video bbbbbbbbbbb from playlist",
      }),
    ).toBeInTheDocument();
  });

  it("offers remove, rename and delete controls", async () => {
    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    expect(screen.getByRole("form", { name: "Rename playlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete playlist" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove .+ from playlist$/ })).toHaveLength(3);
  });

  it("removes a video from the playlist", async () => {
    const user = userEvent.setup();

    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    await user.click(screen.getByRole("button", { name: "Remove First video from playlist" }));

    await waitFor(() => {
      expect(removeFromPlaylistMock).toHaveBeenCalledWith(PLAYLIST.id, "aaaaaaaaaaa");
    });
  });

  it("renames the playlist from the inline form", async () => {
    const user = userEvent.setup();

    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    const input = screen.getByLabelText("Playlist name");
    await user.clear(input);
    await user.type(input, "Summer drive");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(renamePlaylistMock).toHaveBeenCalledWith(PLAYLIST.id, "Summer drive");
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Playlist renamed.");
  });

  it("confirms before deleting and returns to the playlist list", async () => {
    const user = userEvent.setup();

    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    await user.click(screen.getByRole("button", { name: "Delete playlist" }));

    const confirm = screen.getByRole("group", { name: "Confirm delete playlist" });
    expect(within(confirm).getByText(/Delete “Road trip”\?/)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(deletePlaylistMock).toHaveBeenCalledWith(PLAYLIST.id);
      expect(pushMock).toHaveBeenCalledWith("/library?tab=playlists");
    });
  });

  it("skips the metadata request for an empty playlist", async () => {
    getPlaylistForPageMock.mockReturnValue({ ...PLAYLIST, videoIds: [] });

    render(await PlaylistPageContent({ params: paramsFor(PLAYLIST.id) }));

    expect(screen.getByText("No videos in this playlist yet")).toBeInTheDocument();
    expect(getVideosMock).not.toHaveBeenCalled();
  });

  it("calls notFound for an invalid playlist id", async () => {
    await expect(PlaylistPageContent({ params: paramsFor("   ") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getPlaylistForPageMock).not.toHaveBeenCalled();
    expect(getVideosMock).not.toHaveBeenCalled();
  });

  it("calls notFound when the playlist does not exist", async () => {
    getPlaylistForPageMock.mockReturnValue(null);

    await expect(PlaylistPageContent({ params: paramsFor("playlist-missing") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideosMock).not.toHaveBeenCalled();
  });
});
