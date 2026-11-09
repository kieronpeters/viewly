import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getVideoMock, notFoundMock } = vi.hoisted(() => ({
  getVideoMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
// The page tests never hit the YouTube API; the client boundary is mocked.
vi.mock("@/lib/youtube/client", () => ({ getVideo: getVideoMock }));
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
  });

  it("renders the title and channel for a valid video", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(screen.getByRole("heading", { level: 1, name: VIDEO.title })).toBeInTheDocument();
    expect(screen.getByText(VIDEO.channelTitle)).toBeInTheDocument();
    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("leaves labelled player and metadata slots for T30 and T31", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const playerSlot = screen.getByRole("region", { name: "Video player" });
    const detailsSlot = screen.getByRole("complementary", { name: "Video details" });

    expect(playerSlot).toHaveAttribute("data-slot", "watch-player-slot");
    expect(detailsSlot).toHaveAttribute("data-slot", "watch-details-slot");
    // Both placeholders state who fills them, so the hand-off is explicit.
    expect(screen.getByText(/T30 mounts/)).toBeInTheDocument();
    expect(screen.getByText(/T31 mounts/)).toBeInTheDocument();
  });

  it("calls notFound when YouTube returns no video", async () => {
    getVideoMock.mockResolvedValue(null);

    await expect(WatchPageContent({ params: paramsFor(VIDEO_ID) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid id before calling the client", async () => {
    await expect(WatchPageContent({ params: paramsFor("not-a-video-id") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideoMock).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledTimes(1);
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
