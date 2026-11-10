import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readChannelMock, notFoundMock } = vi.hoisted(() => ({
  readChannelMock: vi.fn(),
  // Next's real notFound() throws a control-flow error Next catches; mirror it.
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
// Only the data read is replaced, so the page's own composition runs.
vi.mock("./read-channel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./read-channel")>();
  return { ...actual, readChannel: readChannelMock };
});

import type { ChannelDetail, VideoSummary } from "@/shared/types";

import { ChannelPageContent } from "./channel-page-content";

const CHANNEL_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";

const CHANNEL: ChannelDetail = {
  id: CHANNEL_ID,
  title: "Rick Astley",
  avatarUrl: "https://yt3.ggpht.com/channel-high=s800",
  subscriberCount: 4_200_000,
  description: "The official Rick Astley channel.\nNew uploads every decade.",
  uploadsPlaylistId: "UUuAXFkgsw1L7xaCfnd5JJOw",
};

const UPLOAD: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelId: CHANNEL_ID,
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: null,
  viewCount: null,
};

const SECOND_UPLOAD: VideoSummary = {
  ...UPLOAD,
  id: "J---aiyznGQ",
  title: "Together Forever",
  thumbnailUrl: "https://i.ytimg.com/vi/J---aiyznGQ/hqdefault.jpg",
};

function ok(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    channel: CHANNEL,
    uploads: [UPLOAD, SECOND_UPLOAD],
    uploadsUnavailable: false,
    ...overrides,
  };
}

/** Invokes the async server component directly, then renders its output. */
async function renderChannel(id = CHANNEL_ID) {
  return render(await ChannelPageContent({ params: Promise.resolve({ id }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  readChannelMock.mockResolvedValue(ok());
});

describe("ChannelPageContent", () => {
  it("renders the avatar, name, subscriber count, description and YouTube link", async () => {
    const { container } = await renderChannel();

    expect(screen.getByRole("heading", { level: 1, name: "Rick Astley" })).toBeInTheDocument();
    expect(screen.getByText("4.2M subscribers")).toBeInTheDocument();
    expect(screen.getByText(/The official Rick Astley channel\./)).toBeInTheDocument();

    const avatar = container.querySelector("img");
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute("src")).toContain(
      encodeURIComponent("https://yt3.ggpht.com/channel-high=s800"),
    );

    const link = screen.getByRole("link", { name: /view on youtube/i });
    expect(link).toHaveAttribute("href", `https://www.youtube.com/channel/${CHANNEL_ID}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent(/opens in a new tab/i);
  });

  it("renders recent uploads as a VideoCard grid linking to the watch page", async () => {
    await renderChannel();

    expect(screen.getByRole("heading", { level: 2, name: "Recent uploads" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Recent uploads" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Never Gonna Give You Up/ })).toHaveAttribute(
      "href",
      "/watch/dQw4w9WgXcQ",
    );
    expect(screen.getByRole("link", { name: /Together Forever/ })).toHaveAttribute(
      "href",
      "/watch/J---aiyznGQ",
    );
    expect(readChannelMock).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it("omits the subscriber line when YouTube hides the count", async () => {
    readChannelMock.mockResolvedValue(ok({ channel: { ...CHANNEL, subscriberCount: null } }));

    await renderChannel();

    expect(screen.queryByText(/subscribers?/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Rick Astley" })).toBeInTheDocument();
  });

  it("omits the description when the channel has none", async () => {
    readChannelMock.mockResolvedValue(ok({ channel: { ...CHANNEL, description: "" } }));

    await renderChannel();

    expect(screen.getByRole("heading", { level: 1, name: "Rick Astley" })).toBeInTheDocument();
    expect(screen.queryByText(/New uploads every decade/)).not.toBeInTheDocument();
  });

  it("shows an empty state when the channel has no uploads", async () => {
    readChannelMock.mockResolvedValue(ok({ uploads: [] }));

    await renderChannel();

    expect(screen.getByText("No uploads yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent uploads" })).not.toBeInTheDocument();
    // The identity card is unaffected.
    expect(screen.getByRole("heading", { level: 1, name: "Rick Astley" })).toBeInTheDocument();
  });

  it("keeps the header and reports an uploads failure without crashing", async () => {
    readChannelMock.mockResolvedValue(ok({ uploads: [], uploadsUnavailable: true }));

    await renderChannel();

    expect(screen.getByRole("heading", { level: 1, name: "Rick Astley" })).toBeInTheDocument();
    expect(screen.getByText("Could not load recent uploads")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on youtube/i })).toBeInTheDocument();
  });

  it("renders a retry state for a failed channel lookup", async () => {
    readChannelMock.mockResolvedValue({ status: "error" });

    await renderChannel();

    expect(screen.getByText("Could not load this channel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      `/channel/${CHANNEL_ID}`,
    );
  });

  it("calls notFound for an unknown or malformed channel", async () => {
    readChannelMock.mockResolvedValue({ status: "not_found" });

    await expect(
      ChannelPageContent({ params: Promise.resolve({ id: "not-a-channel" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
