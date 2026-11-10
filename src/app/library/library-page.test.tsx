import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listFavouriteVideosMock,
  listWatchLaterVideosMock,
  listPlaylistsMock,
  listHistoryEntriesMock,
  countLibraryEntriesMock,
  sweepLibraryMetadataMock,
  clearHistoryEntryMock,
  clearAllHistoryMock,
  listVideoProgressMock,
  listContinueWatchingVideosMock,
} = vi.hoisted(() => ({
  listFavouriteVideosMock: vi.fn(),
  listWatchLaterVideosMock: vi.fn(),
  listPlaylistsMock: vi.fn(),
  listHistoryEntriesMock: vi.fn(),
  countLibraryEntriesMock: vi.fn(),
  sweepLibraryMetadataMock: vi.fn(),
  clearHistoryEntryMock: vi.fn(),
  clearAllHistoryMock: vi.fn(),
  listVideoProgressMock: vi.fn(),
  listContinueWatchingVideosMock: vi.fn(),
}));

// The content half imports the server-only reads through the feature barrel, so
// the barrel is replaced rather than the database. The card's save controls and
// the playlist form import the actions, which must stay inert in jsdom.
vi.mock("@/features/library", () => ({
  listFavouriteVideos: listFavouriteVideosMock,
  listWatchLaterVideos: listWatchLaterVideosMock,
  listPlaylists: listPlaylistsMock,
  countLibraryEntries: countLibraryEntriesMock,
  sweepLibraryMetadata: sweepLibraryMetadataMock,
}));
// History reads and writes are server-only; replace both modules so the tab
// renders fixtures and the clear controls call spies.
vi.mock("@/features/library/history-data", () => ({
  listHistoryEntries: listHistoryEntriesMock,
}));
vi.mock("@/features/library/history-actions", () => ({
  recordView: vi.fn(),
  clearHistoryEntry: clearHistoryEntryMock,
  clearAllHistory: clearAllHistoryMock,
}));
// Playback progress is server-only; the tab renders whatever the map holds, so
// no test opens the real database file.
vi.mock("@/features/progress/progress-data", () => ({
  listVideoProgress: listVideoProgressMock,
}));
// The continue-watching shelf reads SQLite through its own module; replace the
// read so the tab tests never open the real database. It is empty by default,
// which keeps every existing tab assertion unchanged.
vi.mock("@/features/progress/continue-watching", () => ({
  listContinueWatchingVideos: listContinueWatchingVideosMock,
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

import type { HistoryEntry } from "@/features/library/history-data";
import type { PlaylistSummary, VideoSummary } from "@/shared/types";

import { LibraryPageContent } from "./library-page-content";

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

/** Newest first, exactly the order `history.list()` returns. */
const HISTORY: HistoryEntry[] = [
  {
    video: savedVideo("newest-video", "Newest video"),
    lastViewedAt: new Date("2026-01-03T00:00:00Z"),
    viewCount: 3,
  },
  {
    video: savedVideo("middle-video", "Middle video"),
    lastViewedAt: new Date("2026-01-02T00:00:00Z"),
    viewCount: 1,
  },
  {
    video: savedVideo("oldest-video", "Oldest video"),
    lastViewedAt: new Date("2026-01-01T00:00:00Z"),
    viewCount: 2,
  },
];

/** Totals the tab bar shows; deliberately independent of the list fixtures. */
const COUNTS = {
  favourites: VIDEOS.length,
  watchLater: 1,
  history: HISTORY.length,
  playlists: PLAYLISTS.length,
};

beforeEach(() => {
  listFavouriteVideosMock.mockReset();
  listFavouriteVideosMock.mockReturnValue(VIDEOS);
  listWatchLaterVideosMock.mockReset();
  listWatchLaterVideosMock.mockReturnValue([]);
  listPlaylistsMock.mockReset();
  listPlaylistsMock.mockReturnValue(PLAYLISTS);
  listHistoryEntriesMock.mockReset();
  listHistoryEntriesMock.mockReturnValue(HISTORY);
  countLibraryEntriesMock.mockReset();
  countLibraryEntriesMock.mockReturnValue(COUNTS);
  sweepLibraryMetadataMock.mockReset();
  sweepLibraryMetadataMock.mockResolvedValue({
    status: "skipped",
    videoCount: 0,
    refreshedCount: 0,
    unavailableCount: 0,
  });
  clearHistoryEntryMock.mockReset();
  clearHistoryEntryMock.mockResolvedValue(undefined);
  clearAllHistoryMock.mockReset();
  clearAllHistoryMock.mockResolvedValue(undefined);
  listVideoProgressMock.mockReset();
  listVideoProgressMock.mockReturnValue(new Map());
  listContinueWatchingVideosMock.mockReset();
  listContinueWatchingVideosMock.mockResolvedValue([]);
});

describe("LibraryPageContent tab bar", () => {
  it.each([
    ["favourites", "/library"],
    ["watch-later", "/library?tab=watch-later"],
    ["history", "/library?tab=history"],
    ["playlists", "/library?tab=playlists"],
  ] as const)("links all four tabs and marks %s as current", async (tab, href) => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab }) }));

    const nav = screen.getByRole("navigation", { name: "Library sections" });
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/library",
      "/library?tab=watch-later",
      "/library?tab=history",
      "/library?tab=playlists",
    ]);

    // Exactly one link is the current page, and it is the requested tab.
    const current = links.filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual([href]);
  });

  it("shows a count for every tab without reading the other lists", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "favourites" }) }));

    const nav = screen.getByRole("navigation", { name: "Library sections" });

    expect(
      within(nav).getByRole("link", { name: `Favourites (${COUNTS.favourites})` }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: `Watch later (${COUNTS.watchLater})` }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: `History (${COUNTS.history})` }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: `Playlists (${COUNTS.playlists})` }),
    ).toBeInTheDocument();

    expect(countLibraryEntriesMock).toHaveBeenCalledTimes(1);
    expect(listFavouriteVideosMock).toHaveBeenCalledTimes(1);
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
    expect(listHistoryEntriesMock).not.toHaveBeenCalled();
  });

  it("links to the watch-stats page beside the tabs", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "favourites" }) }));

    expect(screen.getByRole("link", { name: "Watch stats" })).toHaveAttribute(
      "href",
      "/library/stats",
    );

    // It is not a tab: the section nav still exposes exactly the four tabs.
    const nav = screen.getByRole("navigation", { name: "Library sections" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
  });

  it("falls back to favourites for an unknown tab", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "music" }) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `Favourites (${COUNTS.favourites})` })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(listFavouriteVideosMock).toHaveBeenCalledTimes(1);
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
    expect(listHistoryEntriesMock).not.toHaveBeenCalled();
  });
});

describe("LibraryPageContent", () => {
  it("runs the metadata sweep before reading the active list", async () => {
    const order: string[] = [];

    sweepLibraryMetadataMock.mockImplementation(async () => {
      order.push("sweep");

      return { status: "completed", videoCount: 0, refreshedCount: 0, unavailableCount: 0 };
    });
    listFavouriteVideosMock.mockImplementation(() => {
      order.push("list");

      return VIDEOS;
    });

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "favourites" }) }));

    // The list must see the post-sweep rows, never a snapshot the sweep was
    // about to replace.
    expect(order).toEqual(["sweep", "list"]);
    expect(sweepLibraryMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("lists favourites newest first with the toggle enabled on every card", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "favourites" }) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();

    const region = screen.getByRole("region", { name: "Favourites" });

    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/watch/newest-video", "/watch/middle-video", "/watch/oldest-video"]);
    expect(screen.getAllByRole("button", { name: "Remove from favourites" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Add to playlist" })).toHaveLength(3);
    expect(listFavouriteVideosMock).toHaveBeenCalledTimes(1);
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
    expect(listPlaylistsMock).toHaveBeenCalledTimes(1);
  });

  it("shows favourites when no tab is supplied", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Favourites" })).getAllByRole("link"),
    ).toHaveLength(VIDEOS.length);
  });

  it("lists watch later newest first with the watch-later toggle on every card", async () => {
    listWatchLaterVideosMock.mockReturnValue(VIDEOS);

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "watch-later" }) }));

    expect(screen.getByRole("heading", { name: "Watch later", level: 2 })).toBeInTheDocument();

    const region = screen.getByRole("region", { name: "Watch later" });

    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/watch/newest-video", "/watch/middle-video", "/watch/oldest-video"]);
    expect(screen.getAllByRole("button", { name: "Remove from Watch Later" })).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Remove from favourites" }),
    ).not.toBeInTheDocument();
    expect(listWatchLaterVideosMock).toHaveBeenCalledTimes(1);
    expect(listFavouriteVideosMock).not.toHaveBeenCalled();
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

    const links = within(screen.getByRole("region", { name: "Playlists" })).getAllByRole("link");
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

  it("wraps a long playlist name instead of overflowing its row", async () => {
    // Playlist names are user input up to 60 characters with no spaces, so the
    // row has to break the word rather than widen the page.
    const longName = "a".repeat(60);
    listPlaylistsMock.mockReturnValue([{ id: "playlist-long", name: longName, itemCount: 1 }]);

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "playlists" }) }));

    expect(screen.getByText(longName)).toHaveClass("min-w-0", "break-words");
  });

  it("renders a playlists empty state above the create form", async () => {
    listPlaylistsMock.mockReturnValue([]);

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "playlists" }) }));

    expect(screen.getByText("No playlists yet")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create a playlist" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Browse videos" })).not.toBeInTheDocument();
  });
});

describe("LibraryPageContent history tab", () => {
  it("lists watched videos newest first with the local view count", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    expect(screen.getByRole("heading", { name: "History", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("3 watched videos, newest first.")).toBeInTheDocument();

    const region = screen.getByRole("region", { name: "History" });

    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/watch/newest-video", "/watch/middle-video", "/watch/oldest-video"]);
    expect(screen.getByText("Watched 3 times")).toBeInTheDocument();
    expect(screen.getByText("Watched once")).toBeInTheDocument();
    expect(screen.getByText("Watched 2 times")).toBeInTheDocument();

    expect(listHistoryEntriesMock).toHaveBeenCalledTimes(1);
    expect(listFavouriteVideosMock).not.toHaveBeenCalled();
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
    expect(listPlaylistsMock).not.toHaveBeenCalled();
  });

  it("renders the empty state without any clear controls", async () => {
    listHistoryEntriesMock.mockReturnValue([]);

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    expect(screen.getByText("No watch history yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse videos" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("confirms before removing one video from history", async () => {
    const user = userEvent.setup();

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    await user.click(screen.getByRole("button", { name: "Remove Newest video from history" }));

    const confirm = screen.getByRole("group", { name: "Confirm remove from history" });

    expect(
      within(confirm).getByText(/Remove “Newest video” from your watch history\?/),
    ).toBeInTheDocument();
    expect(clearHistoryEntryMock).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Remove permanently" }));

    await waitFor(() => {
      expect(clearHistoryEntryMock).toHaveBeenCalledWith("newest-video");
    });
  });

  it("cancels a per-item removal without writing", async () => {
    const user = userEvent.setup();

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    await user.click(screen.getByRole("button", { name: "Remove Middle video from history" }));
    await user.click(
      within(screen.getByRole("group", { name: "Confirm remove from history" })).getByRole(
        "button",
        {
          name: "Cancel",
        },
      ),
    );

    expect(screen.queryByRole("group", { name: "Confirm remove from history" })).toBeNull();
    expect(clearHistoryEntryMock).not.toHaveBeenCalled();
  });

  it("confirms before clearing the whole history", async () => {
    const user = userEvent.setup();

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    await user.click(screen.getByRole("button", { name: "Clear watch history" }));

    const confirm = screen.getByRole("group", { name: "Confirm clear watch history" });

    expect(within(confirm).getByText(/Clear all 3 watched videos\?/)).toBeInTheDocument();
    expect(clearAllHistoryMock).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Clear permanently" }));

    await waitFor(() => {
      expect(clearAllHistoryMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("LibraryPageContent continue watching", () => {
  const items = [
    {
      video: savedVideo("continue0001", "Continue newest"),
      progress: { positionSeconds: 30, durationSeconds: 60 },
    },
    {
      video: savedVideo("continue0002", "Continue older"),
      progress: { positionSeconds: 12, durationSeconds: 60 },
    },
  ];

  it("shows the local shelf above the active tab with progress bars", async () => {
    listContinueWatchingVideosMock.mockResolvedValue(items);

    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "Continue watching", level: 2 }),
    ).toBeInTheDocument();

    const region = screen.getByRole("region", { name: "Continue watching" });

    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/watch/continue0001", "/watch/continue0002"]);
    expect(within(region).getAllByRole("progressbar", { name: "Watch progress" })).toHaveLength(
      items.length,
    );

    // The shelf is not a tab: the tab list still has exactly its four links.
    expect(
      within(screen.getByRole("navigation", { name: "Library sections" })).getAllByRole("link"),
    ).toHaveLength(4);
  });

  it("hides the shelf when nothing is in progress", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("heading", { name: "Continue watching" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Continue watching" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
  });
});

describe("LibraryPageContent playback progress", () => {
  const progress = {
    videoId: "newest-video",
    positionSeconds: 30,
    durationSeconds: 60,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("passes stored progress to favourite cards", async () => {
    listVideoProgressMock.mockReturnValue(new Map([[progress.videoId, progress]]));

    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(listVideoProgressMock).toHaveBeenCalledWith(VIDEOS.map((video) => video.id));
    expect(screen.getAllByRole("progressbar", { name: "Watch progress" })).toHaveLength(1);
  });

  it("passes stored progress to history cards", async () => {
    listVideoProgressMock.mockReturnValue(new Map([[progress.videoId, progress]]));

    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    expect(screen.getAllByRole("progressbar", { name: "Watch progress" })).toHaveLength(1);
  });

  it("renders no bars when no video has progress", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "history" }) }));

    expect(screen.queryByRole("progressbar", { name: "Watch progress" })).toBeNull();
  });
});
