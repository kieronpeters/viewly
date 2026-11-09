import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getVideoMock, notFoundMock, isVideoFavouriteMock } = vi.hoisted(() => ({
  getVideoMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  isVideoFavouriteMock: vi.fn(),
}));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
// The page tests never hit the YouTube API; the client boundary is mocked.
vi.mock("@/lib/youtube/client", () => ({ getVideo: getVideoMock }));
// The saved state is a local database read; stub it so no file is opened.
vi.mock("@/features/library", () => ({ isVideoFavourite: isVideoFavouriteMock }));
// The header control imports the action; it stays inert in these tests.
vi.mock("@/features/library/actions", () => ({ toggleFavourite: vi.fn() }));
// Next's real notFound() throws a control-flow error Next catches; mirror it.
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

import type { VideoDetail } from "@/shared/types";

import { generateMetadata } from "./page";
import { WatchPageContent } from "./watch-page-content";

const VIDEO_ID = "dQw4w9WgXcQ";

/** Hand-written fixture, shaped like a normalized `videos.list` item. */
const VIDEO: VideoDetail = {
  id: VIDEO_ID,
  title: "Never Gonna Give You Up (Official Video)",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_500_000_000,
  description: "The official video for Never Gonna Give You Up.",
};

function paramsFor(videoId: string): Promise<{ videoId: string }> {
  return Promise.resolve({ videoId });
}

describe("WatchPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVideoMock.mockResolvedValue(null);
    isVideoFavouriteMock.mockReset();
    isVideoFavouriteMock.mockReturnValue(false);
  });

  it("renders the title and channel for a valid video", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(screen.getByRole("heading", { level: 1, name: VIDEO.title })).toBeInTheDocument();
    // The channel appears under the title and again in the details panel.
    expect(screen.getAllByText(VIDEO.channelTitle).length).toBeGreaterThan(0);
    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("mounts the player and the metadata panel in their labelled slots", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const playerSlot = screen.getByRole("region", { name: "Video player" });
    const detailsSlot = screen.getByRole("complementary", { name: "Video details" });

    expect(playerSlot).toHaveAttribute("data-slot", "watch-player-slot");
    expect(detailsSlot).toHaveAttribute("data-slot", "watch-details-slot");
    expect(within(playerSlot).getByTitle(/YouTube video player/)).toBeInTheDocument();
    expect(within(playerSlot).getByRole("link", { name: /open on youtube/i })).toBeInTheDocument();
    // T31 replaced the placeholder: the slot now renders real metadata.
    expect(within(detailsSlot).getByText("1.5B")).toBeInTheDocument();
    expect(within(detailsSlot).getByText("3:33")).toBeInTheDocument();
    expect(within(detailsSlot).queryByText(/T31 mounts/)).not.toBeInTheDocument();
  });

  it("hydrates the favourite control from the stored state", async () => {
    getVideoMock.mockResolvedValue(VIDEO);
    isVideoFavouriteMock.mockReturnValue(true);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const button = screen.getByRole("button", { name: "Remove from favourites" });

    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(isVideoFavouriteMock).toHaveBeenCalledWith(VIDEO_ID);
  });

  it("shows an add control for a video that is not saved", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(screen.getByRole("button", { name: "Add to favourites" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls notFound when YouTube returns no video", async () => {
    getVideoMock.mockResolvedValue(null);

    await expect(WatchPageContent({ params: paramsFor(VIDEO_ID) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(isVideoFavouriteMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid id before calling the client", async () => {
    await expect(WatchPageContent({ params: paramsFor("not-a-video-id") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideoMock).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(isVideoFavouriteMock).not.toHaveBeenCalled();
  });

  it("rejects an empty id before calling the client", async () => {
    await expect(WatchPageContent({ params: paramsFor("") })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getVideoMock).not.toHaveBeenCalled();
  });
});

/**
 * The default page export is only a static shell plus `<Suspense>`; a direct
 * RTL render would suspend on the async child. Its data/layout half is covered
 * above via `WatchPageContent`, and `generateMetadata` is exercised directly.
 */
describe("generateMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVideoMock.mockResolvedValue(null);
  });

  it("uses the video title", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    await expect(generateMetadata({ params: paramsFor(VIDEO_ID) })).resolves.toEqual({
      title: VIDEO.title,
    });
  });

  it("falls back without calling the client for an invalid id", async () => {
    await expect(generateMetadata({ params: paramsFor("bad") })).resolves.toEqual({
      title: "Video not found",
    });

    expect(getVideoMock).not.toHaveBeenCalled();
  });

  it("falls back when the video is missing", async () => {
    getVideoMock.mockResolvedValue(null);

    await expect(generateMetadata({ params: paramsFor(VIDEO_ID) })).resolves.toEqual({
      title: "Video not found",
    });
  });
});
