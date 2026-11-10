import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getVideoMock,
  getChannelMock,
  watchSuggestionsPropsMock,
  notFoundMock,
  isVideoFavouriteMock,
  isInWatchLaterMock,
  listPlaylistsMock,
  listVideoNotesMock,
  getVideoProgressMock,
} = vi.hoisted(() => ({
  getVideoMock: vi.fn(),
  getChannelMock: vi.fn(),
  watchSuggestionsPropsMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  isVideoFavouriteMock: vi.fn(),
  isInWatchLaterMock: vi.fn(),
  listPlaylistsMock: vi.fn(),
  listVideoNotesMock: vi.fn(),
  getVideoProgressMock: vi.fn(),
}));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
// The page tests never hit the YouTube API; the client boundary is mocked.
vi.mock("@/lib/youtube/client", () => ({
  getVideo: getVideoMock,
  getChannel: getChannelMock,
}));
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
// The notes panel is seeded from a local database read; stub both halves so no
// file is opened and the actions never run.
vi.mock("@/features/notes", () => ({ listVideoNotes: listVideoNotesMock }));
// Progress is a server-only read; stub it so no test opens the database file.
vi.mock("@/features/progress/progress-data", () => ({
  getVideoProgress: getVideoProgressMock,
}));
vi.mock("@/features/notes/actions", () => ({
  addNote: vi.fn(),
  editNote: vi.fn(),
  deleteNote: vi.fn(),
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
// The queue rail reads `useRouter` for autoplay navigation, which never fires
// in these layout tests.
vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  useRouter: () => ({ push: vi.fn() }),
}));

import { EnvConfigurationError } from "@/lib/env";
import type { ChannelDetail, VideoDetail } from "@/shared/types";

import { generateMetadata } from "./page";
import { WatchPageContent } from "./watch-page-content";

const VIDEO_ID = "dQw4w9WgXcQ";

/**
 * The comments panel fetches its own route after mount. By default it stays
 * pending, so unrelated layout tests never see a late state update; the tab
 * test resolves it explicitly.
 */
const commentsFetchMock =
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function emptyCommentsResponse(): Response {
  return new Response(JSON.stringify({ items: [], nextPageToken: null, commentsDisabled: false }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  commentsFetchMock.mockReset();
  commentsFetchMock.mockImplementation(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", commentsFetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** Hand-written fixture, shaped like a normalized `channels.list` item. */
const CHANNEL: ChannelDetail = {
  id: VIDEO.channelId,
  title: "Rick Astley",
  avatarUrl: "https://yt3.ggpht.com/channel-high=s800",
  subscriberCount: 4_200_000,
  description: "The official Rick Astley channel.",
  uploadsPlaylistId: "UUuAXFkgsw1L7xaCfnd5JJOw",
};

function paramsFor(videoId: string): Promise<{ videoId: string }> {
  return Promise.resolve({ videoId });
}

describe("WatchPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVideoMock.mockResolvedValue(null);
    getChannelMock.mockReset();
    getChannelMock.mockResolvedValue(null);
    isVideoFavouriteMock.mockReset();
    isVideoFavouriteMock.mockReturnValue(false);
    isInWatchLaterMock.mockReset();
    isInWatchLaterMock.mockReturnValue(false);
    listPlaylistsMock.mockReset();
    listPlaylistsMock.mockReturnValue([
      { id: "playlist-road-trip", name: "Road trip", itemCount: 2 },
    ]);
    listVideoNotesMock.mockReset();
    listVideoNotesMock.mockReturnValue([]);
    getVideoProgressMock.mockReset();
    getVideoProgressMock.mockReturnValue(null);
  });

  it("renders the title and channel for a valid video", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(screen.getByRole("heading", { level: 1, name: VIDEO.title })).toBeInTheDocument();
    // The channel name lives in the channel row under the title.
    expect(screen.getAllByText(VIDEO.channelTitle).length).toBeGreaterThan(0);
    expect(getVideoMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("renders the channel card with the avatar and subscriber count from channels.list", async () => {
    getVideoMock.mockResolvedValue(VIDEO);
    getChannelMock.mockResolvedValue(CHANNEL);

    const { container } = render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    // One channels.list call for the video's channel, made through the reader.
    expect(getChannelMock).toHaveBeenCalledTimes(1);
    expect(getChannelMock).toHaveBeenCalledWith(VIDEO.channelId);

    const card = container.querySelector<HTMLElement>('[data-slot="watch-channel-card"]');
    expect(card).not.toBeNull();
    if (card === null) {
      throw new Error("Unreachable: the channel card is missing.");
    }

    expect(within(card).getByText("Rick Astley")).toBeInTheDocument();
    expect(within(card).getByText("4.2M subscribers")).toBeInTheDocument();
    expect(card.querySelector("img")).not.toBeNull();

    const link = within(card).getByRole("link", { name: /view on youtube/i });
    expect(link).toHaveAttribute("href", `https://www.youtube.com/channel/${VIDEO.channelId}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("keeps the player and a working channel card when the channel lookup fails", async () => {
    getVideoMock.mockResolvedValue(VIDEO);
    getChannelMock.mockRejectedValue(new Error("quota exceeded"));

    const { container } = render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    // The player, title and actions are unaffected by the failed enrichment.
    expect(screen.getByRole("region", { name: "Video player" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: VIDEO.title })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Video actions" })).toBeInTheDocument();

    const card = container.querySelector<HTMLElement>('[data-slot="watch-channel-card"]');
    expect(card).not.toBeNull();
    if (card === null) {
      throw new Error("Unreachable: the channel card is missing.");
    }

    // Snippet values take over, no count is invented, and the link stays valid.
    expect(within(card).getByText(VIDEO.channelTitle)).toBeInTheDocument();
    expect(within(card).queryByText(/subscribers?/)).not.toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /view on youtube/i })).toHaveAttribute(
      "href",
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    );
  });

  it("puts the channel card before the actions in the responsive header row", async () => {
    getVideoMock.mockResolvedValue(VIDEO);
    getChannelMock.mockResolvedValue(CHANNEL);

    const { container } = render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const row = container.querySelector<HTMLElement>('[data-slot="watch-channel-row"]');
    const card = container.querySelector<HTMLElement>('[data-slot="watch-channel-card"]');
    const actions = screen.getByRole("group", { name: "Video actions" });

    expect(row).not.toBeNull();
    expect(card).not.toBeNull();
    if (row === null || card === null) {
      throw new Error("Unreachable: the header row is missing.");
    }

    // Below `sm` the row stacks the card above the actions at 390px; from `sm`
    // they share one line with the actions pushed to the end.
    expect(row).toHaveClass("flex-col", "sm:flex-row", "sm:items-center", "sm:justify-between");
    expect(row.firstElementChild).toBe(card);
    expect(card.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("describes the player-led grid and stacks it on small screens", async () => {
    // Desktop is a two-column grid: the player column plus a 360px rail. Below
    // `lg` the grid collapses to one column, so the DOM order is the mobile
    // reading order: player, title, actions, description, discussion, related.
    // jsdom has no layout, so the strategy is the assertion.
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const playerSlot = screen.getByRole("region", { name: "Video player" });
    const title = screen.getByRole("heading", { level: 1, name: VIDEO.title });
    const channelRow = screen
      .getByText(VIDEO.channelTitle)
      .closest('[data-slot="watch-channel-row"]');
    const actionRow = screen.getByRole("group", { name: "Video actions" });
    const description = screen.getByRole("region", { name: "Description" });
    const discussion = screen.getByRole("region", { name: "Comments and notes" });
    const rail = screen.getByRole("complementary", { name: "Suggested videos" });

    expect(
      playerSlot.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(actionRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      actionRow.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(discussion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      discussion.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(channelRow).not.toBeNull();
    expect(channelRow).toHaveClass("flex-col", "sm:flex-row");
    expect(rail.parentElement).toHaveClass(
      "grid-cols-1",
      "lg:grid-cols-[minmax(0,1fr)_20rem]",
      "xl:grid-cols-[minmax(0,1fr)_22.5rem]",
    );
    expect(rail).toHaveClass("lg:sticky", "lg:top-4");
  });

  it("mounts the player and the description in their labelled slots", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const playerSlot = screen.getByRole("region", { name: "Video player" });
    const description = screen.getByRole("region", { name: "Description" });

    expect(playerSlot).toHaveAttribute("data-slot", "watch-player-slot");
    expect(description).toHaveAttribute("data-slot", "watch-description");
    // T35 moved the embed behind the IFrame API client component; the reserved
    // box and the fallback link are the server-rendered, always-present parts.
    expect(playerSlot.querySelector('[data-slot="youtube-player"]')).not.toBeNull();
    expect(within(playerSlot).getByRole("link", { name: /open on youtube/i })).toBeInTheDocument();
    // The old sidebar metadata moved under the title, keeping the same
    // deterministic views/duration/date formatting and safe description.
    expect(within(description).getByText("1.5B views")).toBeInTheDocument();
    expect(within(description).getByText("3:33")).toBeInTheDocument();
    expect(within(description).getByText("Published 25 Oct 2009")).toBeInTheDocument();
    expect(within(description).getByText(VIDEO.description)).toBeInTheDocument();
  });

  it("offers the listen-mode switch beside the player controls", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    // Video mode is the default, so the switch is off and the full meta block
    // (title, channel, actions) is present.
    expect(screen.getByRole("switch", { name: "Listen mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("heading", { level: 1, name: VIDEO.title })).toBeInTheDocument();
  });

  it("renders clickable timestamps and a Chapters list for a chaptered description", async () => {
    getVideoMock.mockResolvedValue({
      ...VIDEO,
      description: "0:00 Intro\n12:34 Demo\n1:02:03 Encore",
    });

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const description = screen.getByRole("region", { name: "Description" });

    // Inline timestamps are buttons, so a click cannot navigate.
    expect(within(description).getByRole("button", { name: "Seek to 12:34" })).toBeInTheDocument();
    expect(within(description).getByRole("heading", { name: "Chapters" })).toBeInTheDocument();
    expect(within(description).getByRole("button", { name: "1:02:03 Encore" })).toBeInTheDocument();
    expect(within(description).queryAllByRole("link")).toHaveLength(0);
  });

  it("mounts the Up next rail beside the player, wired to this video", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const playerSlot = screen.getByRole("region", { name: "Video player" });
    const rail = screen.getByRole("complementary", { name: "Suggested videos" });

    expect(rail).toHaveAttribute("data-slot", "watch-up-next-slot");
    // It occupies the right column on desktop and follows the discussion in DOM
    // order, which is where it lands in the single-column mobile stack.
    expect(
      playerSlot.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(watchSuggestionsPropsMock).toHaveBeenCalledWith({
      channelTitle: VIDEO.channelTitle,
      currentVideoId: VIDEO_ID,
    });
  });

  it("offers a copy-link action beside the save controls", async () => {
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const actions = screen.getByRole("group", { name: "Video actions" });

    expect(within(actions).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Add to playlist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on youtube/i })).toBeInTheDocument();
  });

  it("shows comments and notes tabs with authored empty states", async () => {
    const user = userEvent.setup();
    getVideoMock.mockResolvedValue(VIDEO);
    commentsFetchMock.mockResolvedValueOnce(emptyCommentsResponse());

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    const commentsTab = screen.getByRole("tab", { name: "Comments" });
    const notesTab = screen.getByRole("tab", { name: "Your notes" });

    expect(commentsTab).toHaveAttribute("aria-selected", "true");
    expect(notesTab).toHaveAttribute("aria-selected", "false");

    const commentsPanel = screen.getByRole("tabpanel", { name: "Comments" });
    expect(await within(commentsPanel).findByText("No comments yet")).toBeInTheDocument();
    // The comments panel owns its data; the video id is passed to its route.
    expect(commentsFetchMock).toHaveBeenCalledTimes(1);
    expect(String(commentsFetchMock.mock.calls[0]?.[0])).toContain(
      `/api/videos/${VIDEO_ID}/comments`,
    );

    await user.click(notesTab);

    expect(notesTab).toHaveAttribute("aria-selected", "true");
    expect(commentsTab).toHaveAttribute("aria-selected", "false");

    const notesPanel = screen.getByRole("tabpanel", { name: "Your notes" });
    expect(within(notesPanel).getByText("No notes yet")).toBeInTheDocument();
    expect(within(notesPanel).getByText(/notes stay on this device/i)).toBeInTheDocument();
  });

  it("moves between the discussion tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    getVideoMock.mockResolvedValue(VIDEO);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    screen.getByRole("tab", { name: "Comments" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Your notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Comments" })).toHaveAttribute("aria-selected", "true");
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

describe("WatchPageContent resume prompt", () => {
  beforeEach(() => {
    getVideoMock.mockReset();
    getVideoMock.mockResolvedValue(VIDEO);
    getChannelMock.mockReset();
    getChannelMock.mockResolvedValue(null);
    isVideoFavouriteMock.mockReset();
    isVideoFavouriteMock.mockReturnValue(false);
    isInWatchLaterMock.mockReset();
    isInWatchLaterMock.mockReturnValue(false);
    listPlaylistsMock.mockReset();
    listPlaylistsMock.mockReturnValue([]);
    listVideoNotesMock.mockReset();
    listVideoNotesMock.mockReturnValue([]);
    getVideoProgressMock.mockReset();
  });

  it("shows the resume prompt for a stored position in range", async () => {
    getVideoProgressMock.mockReturnValue({
      videoId: VIDEO_ID,
      positionSeconds: 60,
      durationSeconds: 200,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(getVideoProgressMock).toHaveBeenCalledWith(VIDEO_ID);
    expect(screen.getByRole("button", { name: "Resume from 1:00" })).toBeInTheDocument();
  });

  it("shows no prompt when the video has no saved progress", async () => {
    getVideoProgressMock.mockReturnValue(null);

    render(await WatchPageContent({ params: paramsFor(VIDEO_ID) }));

    expect(screen.queryByRole("button", { name: /Resume from/ })).toBeNull();
  });
});
