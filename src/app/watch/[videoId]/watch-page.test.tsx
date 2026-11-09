import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getVideoMock,
  watchSuggestionsPropsMock,
  notFoundMock,
  isVideoFavouriteMock,
  isInWatchLaterMock,
  listPlaylistsMock,
} = vi.hoisted(() => ({
  getVideoMock: vi.fn(),
  watchSuggestionsPropsMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  isVideoFavouriteMock: vi.fn(),
  isInWatchLaterMock: vi.fn(),
  listPlaylistsMock: vi.fn(),
}));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
// The page tests never hit the YouTube API; the client boundary is mocked.
vi.mock("@/lib/youtube/client", () => ({ getVideo: getVideoMock }));
// The suggestions section is an async Server Component. React cannot render an
// async component in a client test tree, so it is replaced by a sync stub that
// records its props; the real section is covered in `watch-suggestions.test`.
vi.mock("./watch-suggestions", () => ({
  WatchSuggestions: (props: { channelTitle: string; currentVideoId: string }) => {
    watchSuggestionsPropsMock(props);
    return <section aria-label="More from this channel" data-slot="watch-suggestions" />;
  },
  WatchSuggestionsSkeleton: () => <p>Loading suggestions…</p>,
}));
// The saved state is a local database read; stub it so no file is opened.
vi.mock("@/features/library", () => ({
  isVideoFavourite: isVideoFavouriteMock,
  isInWatchLater: isInWatchLaterMock,
  listPlaylists: listPlaylistsMock,
}));
// The header controls import the actions; they stay inert in these tests.
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));
// The player wrapper imports the history action; it never runs here.
vi.mock("@/features/library/history-actions", () => ({
  recordView: vi.fn(),
  clearHistoryEntry: vi.fn(),
  clearAllHistory: vi.fn(),
}));
// jsdom never executes the IFrame API, so the loader stays pending: the
// player renders its reserved box and fallback link exactly as a blocked
// third-party script would.
vi.mock("@/components/video/youtube-iframe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/video/youtube-iframe-api")>();

  return { ...actual, loadYoutubeIframeApi: () => new Promise(() => {}) };
});
vi.mock("@/features/library/playlist-actions", () => ({
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
}));
// Next's real notFound() throws a control-flow error Next catches; mirror it.
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

import { EnvConfigurationError } from "@/lib/env";
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
    isInWatchLaterMock.mockReset();
    isInWatchLaterMock.mockReturnValue(false);
    listPlaylistsMock.mockReset();
    listPlaylistsMock.mockReturnValue([
      { id: "playlist-road-trip", name: "Road trip", itemCount: 2 },
    ]);
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

  it("stacks the save controls under the title on small screens", async () => {
    // The 360px header cannot hold a wrapping title and three 44px controls in
    // one row, so the header reflows to a column below `sm` and returns to a
    // row from `sm` up. jsdom has no layout, so the strategy is the assertion.
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const header = screen.getByRole("heading", { level: 1 }).closest("header");

    expect(header).not.toBeNull();
    expect(header).toHaveClass("flex-col", "sm:flex-row");
  });

  it("mounts the player and the metadata panel in their labelled slots", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const playerSlot = screen.getByRole("region", { name: "Video player" });
    const detailsSlot = screen.getByRole("complementary", { name: "Video details" });

    expect(playerSlot).toHaveAttribute("data-slot", "watch-player-slot");
    expect(detailsSlot).toHaveAttribute("data-slot", "watch-details-slot");
    // T35 moved the embed behind the IFrame API client component; the reserved
    // box and the fallback link are the server-rendered, always-present parts.
    expect(playerSlot.querySelector('[data-slot="youtube-player"]')).not.toBeNull();
    expect(within(playerSlot).getByRole("link", { name: /open on youtube/i })).toBeInTheDocument();
    // T31 replaced the placeholder: the slot now renders real metadata.
    expect(within(detailsSlot).getByText("1.5B")).toBeInTheDocument();
    expect(within(detailsSlot).getByText("3:33")).toBeInTheDocument();
    expect(within(detailsSlot).queryByText(/T31 mounts/)).not.toBeInTheDocument();
  });

  it("mounts the suggestions section below the player, wired to this video", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const playerSlot = screen.getByRole("region", { name: "Video player" });
    const suggestions = screen.getByRole("region", { name: "More from this channel" });

    // Below the player in the left column, not above the metadata panel.
    expect(
      playerSlot.compareDocumentPosition(suggestions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(watchSuggestionsPropsMock).toHaveBeenCalledWith({
      channelTitle: VIDEO.channelTitle,
      currentVideoId: VIDEO_ID,
    });
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

  it("hydrates the watch-later control from the stored state", async () => {
    getVideoMock.mockResolvedValue(VIDEO);
    isInWatchLaterMock.mockReturnValue(true);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const button = screen.getByRole("button", { name: "Remove from Watch Later" });

    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(isInWatchLaterMock).toHaveBeenCalledWith(VIDEO_ID);
  });

  it("shows both save controls for a video that is not saved", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(screen.getByRole("button", { name: "Add to favourites" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Watch Later" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(isInWatchLaterMock).toHaveBeenCalledWith(VIDEO_ID);
  });

  it("offers the add-to-playlist picker next to the save controls", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const picker = screen.getByRole("button", { name: "Add to playlist" });

    expect(picker).toHaveAttribute("aria-expanded", "false");
    expect(listPlaylistsMock).toHaveBeenCalledTimes(1);
  });

  it("reads both saved states only after the video resolves", async () => {
    getVideoMock.mockResolvedValue(VIDEO);
    isVideoFavouriteMock.mockReturnValue(true);
    isInWatchLaterMock.mockReturnValue(true);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(isVideoFavouriteMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(isInWatchLaterMock).toHaveBeenCalledWith(VIDEO_ID);
  });

  it("calls notFound when YouTube returns no video", async () => {
    getVideoMock.mockResolvedValue(null);

    await expect(WatchPageContent({ params: paramsFor(VIDEO_ID) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(isVideoFavouriteMock).not.toHaveBeenCalled();
    expect(isInWatchLaterMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid id before calling the client", async () => {
    await expect(WatchPageContent({ params: paramsFor("not-a-video-id") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideoMock).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(isVideoFavouriteMock).not.toHaveBeenCalled();
    expect(isInWatchLaterMock).not.toHaveBeenCalled();
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

/**
 * T47: a keyless deployment must explain itself on the watch page.
 *
 * `readWatchVideo` turns `EnvConfigurationError` into a value, so neither
 * `generateMetadata` nor the body throws and no server detail (message, stack,
 * path, key) can reach the HTML.
 */
describe("when YOUTUBE_API_KEY is missing", () => {
  const RAW_MESSAGE =
    "YOUTUBE_API_KEY is missing. Add it to .env.local in the project root; " +
    "it is server-side only and must not be prefixed with NEXT_PUBLIC_.";

  function configurationError(message = RAW_MESSAGE): EnvConfigurationError {
    return new EnvConfigurationError("missing_youtube_api_key", message);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getVideoMock.mockRejectedValue(configurationError());
  });

  it("renders the authored setup state instead of the player", async () => {
    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(
      screen.getByRole("heading", { level: 1, name: "YouTube is not configured" }),
    ).toBeInTheDocument();
    expect(screen.getByText("YOUTUBE_API_KEY")).toBeInTheDocument();
    expect(screen.getByText(".env.local")).toBeInTheDocument();
    expect(screen.getByText(/restart the app/i)).toBeInTheDocument();
    // The player, suggestions and saved-state reads are skipped entirely.
    expect(screen.queryByRole("region", { name: "Video player" })).not.toBeInTheDocument();
    expect(isVideoFavouriteMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("never renders the error message, a stack, a path or the key value", async () => {
    // Deliberately hostile: a message that carries a local path, a stack frame
    // and the configured key, in case a future change forwards it.
    const keyValue = "AIzaSyFAKEKEYvalue0123456789abcdefg";
    const hostileMessage =
      `${RAW_MESSAGE} C:\\Users\\dev\\app\\src\\lib\\env.ts ` +
      `at getYoutubeApiKey (C:\\Users\\dev\\app\\src\\lib\\env.ts:61:11) ` +
      `key=${keyValue}`;

    getVideoMock.mockRejectedValue(configurationError(hostileMessage));

    const { container } = render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));
    const html = container.innerHTML;

    expect(html).not.toContain(RAW_MESSAGE);
    expect(html).not.toContain(keyValue);
    expect(html).not.toContain("C:\\");
    expect(html).not.toContain("/src/");
    expect(html).not.toContain("node_modules");
    expect(html).not.toContain("EnvConfigurationError");
    expect(html).not.toContain("at getYoutubeApiKey");
    expect(html).not.toMatch(/\.(?:ts|tsx|js|mjs|cjs):\d+/);
    // The only mentions are the two authored setup instructions.
    expect(html).toContain("YOUTUBE_API_KEY");
    expect(html).toContain(".env.local");
  });

  it("returns a metadata title instead of throwing", async () => {
    const metadata = await generateMetadata({ params: paramsFor(VIDEO_ID) });

    expect(metadata).toEqual({ title: "Video unavailable" });
    expect(JSON.stringify(metadata)).not.toContain("YOUTUBE_API_KEY");
  });

  it("still 404s an invalid id before touching the client", async () => {
    await expect(WatchPageContent({ params: paramsFor("not-a-video-id") })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getVideoMock).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    await expect(generateMetadata({ params: paramsFor("not-a-video-id") })).resolves.toEqual({
      title: "Video not found",
    });
  });

  it("rethrows a genuine failure to the existing error boundary", async () => {
    getVideoMock.mockRejectedValue(new Error("upstream exploded"));

    await expect(WatchPageContent({ params: paramsFor(VIDEO_ID) })).rejects.toThrow(
      "upstream exploded",
    );
    await expect(generateMetadata({ params: paramsFor(VIDEO_ID) })).rejects.toThrow(
      "upstream exploded",
    );
  });
});
