import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listFavouriteVideosMock } = vi.hoisted(() => ({ listFavouriteVideosMock: vi.fn() }));

// The content half imports the server-only read through the feature barrel, so
// the barrel is replaced rather than the database. The card's favourite control
// imports the action, which must stay inert in jsdom.
vi.mock("@/features/library", () => ({ listFavouriteVideos: listFavouriteVideosMock }));
vi.mock("@/features/library/actions", () => ({ toggleFavourite: vi.fn() }));

import type { VideoSummary } from "@/shared/types";

import { LibraryPageContent, resolveLibraryTab } from "./library-page-content";

/** One library row, already projected by `library-data`. */
function favouriteVideo(id: string, title: string): VideoSummary {
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

/** Newest first, exactly the order `favourites.list()` returns. */
const VIDEOS = [
  favouriteVideo("newest-video", "Newest video"),
  favouriteVideo("middle-video", "Middle video"),
  favouriteVideo("oldest-video", "Oldest video"),
];

beforeEach(() => {
  listFavouriteVideosMock.mockReset();
  listFavouriteVideosMock.mockReturnValue(VIDEOS);
});

describe("resolveLibraryTab", () => {
  it.each([
    [undefined, "favourites"],
    ["favourites", "favourites"],
    ["history", "favourites"],
    ["", "favourites"],
    [[], "favourites"],
    [["favourites", "history"], "favourites"],
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
  });

  it("shows favourites when no tab is supplied", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(VIDEOS.length);
  });

  it("falls back to favourites for an unknown tab", async () => {
    render(await LibraryPageContent({ searchParams: Promise.resolve({ tab: "watch-later" }) }));

    expect(screen.getByRole("heading", { name: "Favourites", level: 2 })).toBeInTheDocument();
    expect(listFavouriteVideosMock).toHaveBeenCalledTimes(1);
  });

  it("renders an empty state with a link back to browsing", async () => {
    listFavouriteVideosMock.mockReturnValue([]);

    render(await LibraryPageContent({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("No favourites yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse videos" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
