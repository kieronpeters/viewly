import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listFavouriteVideosMock, listWatchLaterVideosMock } = vi.hoisted(() => ({
  listFavouriteVideosMock: vi.fn(),
  listWatchLaterVideosMock: vi.fn(),
}));

// The content half imports the server-only reads through the feature barrel, so
// the barrel is replaced rather than the database. The card's save controls
// import the actions, which must stay inert in jsdom.
vi.mock("@/features/library", () => ({
  listFavouriteVideos: listFavouriteVideosMock,
  listWatchLaterVideos: listWatchLaterVideosMock,
}));
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));

import type { VideoSummary } from "@/shared/types";

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

beforeEach(() => {
  listFavouriteVideosMock.mockReset();
  listFavouriteVideosMock.mockReturnValue(VIDEOS);
  listWatchLaterVideosMock.mockReset();
  listWatchLaterVideosMock.mockReturnValue([]);
});

describe("resolveLibraryTab", () => {
  it.each([
    [undefined, "favourites"],
    ["favourites", "favourites"],
    ["watch-later", "watch-later"],
    ["history", "favourites"],
    ["", "favourites"],
    [[], "favourites"],
    [["favourites", "history"], "favourites"],
    [["watch-later", "favourites"], "watch-later"],
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
    expect(listFavouriteVideosMock).toHaveBeenCalledTimes(1);
    expect(listWatchLaterVideosMock).not.toHaveBeenCalled();
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
});
