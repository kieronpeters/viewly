import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listFavouriteVideosMock, listWatchLaterVideosMock, listPlaylistsMock } = vi.hoisted(() => ({
  listFavouriteVideosMock: vi.fn(),
  listWatchLaterVideosMock: vi.fn(),
  listPlaylistsMock: vi.fn(),
}));

// The content half imports the server-only reads through the feature barrel, so
// the barrel is replaced rather than the database. The card's save controls and
// the playlist form import the actions, which must stay inert in jsdom.
vi.mock("@/features/library", () => ({
  listFavouriteVideos: listFavouriteVideosMock,
  listWatchLaterVideos: listWatchLaterVideosMock,
  listPlaylists: listPlaylistsMock,
}));
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));
vi.mock("@/features/library/playlist-actions", () => ({
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
}));

import type { PlaylistSummary, VideoSummary } from "@/shared/types";

import { LibraryPageContent, resolveLibraryTab } from "./library-page-content";

/** One library row, already projected by `library-data`. */
function savedVideo(id: string, title: string): VideoSummary {
  return {
    id,
    title,
    channelId: "",
    channelTitle: "Channel",
    thumbnailUrl: `https://example.com/${id}.jpg`,
    publishedAt: "",
    durationSeconds: 60,
    viewCount: null,
  };
}

/** Newest first, exactly the order the repository lists return. */
const VIDEOS = [
  savedVideo("newest-video", "Newest video"),
  savedVideo("middle-video", "Middle video"),
  savedVideo("oldest-video", "Oldest video"),
];

/** Two playlists as `listPlaylists` projects them. */
const PLAYLISTS: PlaylistSummary[] = [
  { id: "playlist-road-trip", name: "Road trip", itemCount: 2 },
  { id: "playlist-lofi", name: "Lofi beats", itemCount: 1 },
];

beforeEach(() => {
  listFavouriteVideosMock.mockReset();
  listFavouriteVideosMock.mockReturnValue(VIDEOS);
  listWatchLaterVideosMock.mockReset();
  listWatchLaterVideosMock.mockReturnValue([]);
  listPlaylistsMock.mockReset();
  listPlaylistsMock.mockReturnValue(PLAYLISTS);
});

describe("resolveLibraryTab", () => {
  it.each([
    [undefined, "favourites"],
    ["favourites", "favourites"],
    ["watch-later", "watch-later"],
    ["playlists", "playlists"],
    ["history", "favourites"],
    ["", "favourites"],
    [[], "favourites"],
    [["favourites", "history"], "favourites"],
    [["watch-later", "favourites"], "watch-later"],
    [["playlists", "favourites"], "playlists"],
  ])("maps %j to %s", (value, expected) => {
    expect(resolveLibraryTab(value)).toBe(expected);
  });
});

describe("LibraryPageContent", () => {
  it("lists favourites newest first with the toggle enabled on every card", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "favourites" }) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/watch/newest-video",
      "/watch/middle-video",
      "/watch/oldest-video",
    ]);
    expect(screen.getAllByRole("button", { name: "Remove from favourites" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Add to playlist" })).toHaveLength(3);
    expect(listFavouriteVideosMock).toHaveBeenCalledTimes(1);
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
    expect(listPlaylistsMock).toHaveBeenCalledTimes(1);
  });

  it("shows favourites when no tab is supplied", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(VIDEOS.length);
  });

  it("lists watch later newest first with the watch-later toggle on every card", async () => {
    listWatchLaterVideosMock.mockReturnValue(VIDEOS);

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "watch-later" }) }));

    expect(screen.getByRole("heading", { name: "Watch later", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/watch/newest-video",
      "/watch/middle-video",
      "/watch/oldest-video",
    ]);
    expect(screen.getAllByRole("button", { name: "Remove from Watch Later" })).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Remove from favourites" }),
    ).not.toBeInTheDocument();
    expect(listWatchLaterVideosMock).toHaveBeenCalledTimes(1);
    expect(listFavouriteVideosMock).not.toHaveBeenCalled();
  });

  it("falls back to favourites for an unknown tab", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
    expect(listFavouriteVideosMock).toHaveBeenCalledTimes(1);
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
  });

  it("renders a favourites empty state with a link back to browsing", async () => {
    listFavouriteVideosMock.mockReturnValue([]);

    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("No favourites yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse videos" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a watch-later empty state with a link back to browsing", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "watch-later" }) }));

    expect(screen.getByText("No videos in Watch Later yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse videos" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists playlists with their item counts and a create form", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "playlists" }) }));

    expect(screen.getByRole("heading", { name: "Playlists", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create a playlist" })).toBeInTheDocument();
    expect(screen.getByLabelText("Playlist name")).toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/library/playlists/playlist-road-trip",
      "/library/playlists/playlist-lofi",
    ]);
    expect(screen.getByText("Road trip")).toBeInTheDocument();
    expect(screen.getByText("2 videos")).toBeInTheDocument();
    expect(screen.getByText("1 video")).toBeInTheDocument();

    expect(listPlaylistsMock).toHaveBeenCalledTimes(1);
    expect(listFavouriteVideosMock).not.toHaveBeenCalled();
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
  });

  it("renders a playlists empty state above the create form", async () => {
    listPlaylistsMock.mockReturnValue([]);

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "playlists" }) }));

    expect(screen.getByText("No playlists yet")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create a playlist" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Browse videos" })).not.toBeInTheDocument();
  });
});
