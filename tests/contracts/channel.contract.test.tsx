import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Channel flow contract — `docs/specs/channel.md` / `channel.json`, specVersion 0.1.0.
 *
 * `it(...)` guards behaviour Viewly already satisfies; `it.fails(...)` asserts a spec
 * requirement it does not meet yet, so the gap is explicit and flips loudly when closed.
 */

const { readChannelMock, notFoundMock } = vi.hoisted(() => ({
  readChannelMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/app/channel/[id]/read-channel", () => ({ readChannel: readChannelMock }));

import type { ChannelDetail, VideoSummary } from "@/shared/types";

import { ChannelDetailView, ChannelPageContent } from "@/app/channel/[id]/channel-page-content";

const CHANNEL: ChannelDetail = {
  id: "contractChannel1",
  title: "Coastline Films",
  avatarUrl: "https://yt3.ggpht.com/contract-avatar=s800",
  subscriberCount: 4_200_000,
  description: "Short documentaries about coastlines.\nNew films every month.",
  uploadsPlaylistId: "UUcontractChannel1",
};

const UPLOAD: VideoSummary = {
  id: "contractUpload1",
  title: "Tides and the people who read them",
  channelId: CHANNEL.id,
  channelTitle: CHANNEL.title,
  thumbnailUrl: "https://i.ytimg.com/vi/contractUpload1/hqdefault.jpg",
  publishedAt: "2026-10-01T09:00:00Z",
  durationSeconds: 754,
  viewCount: 1_500_000,
};

const SECOND_UPLOAD: VideoSummary = {
  ...UPLOAD,
  id: "contractUpload2",
  title: "A harbour at low water",
};

function view(overrides: Partial<React.ComponentProps<typeof ChannelDetailView>> = {}) {
  return render(
    <ChannelDetailView
      channel={CHANNEL}
      uploads={[UPLOAD, SECOND_UPLOAD]}
      uploadsUnavailable={false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readChannelMock.mockResolvedValue({
    status: "ok",
    channel: CHANNEL,
    uploads: [UPLOAD],
    uploadsUnavailable: false,
  });
});

describe("channel contract: identity", () => {
  it("names the channel with a level-one heading, subscriber count and description", () => {
    view();

    expect(screen.getByRole("heading", { level: 1, name: CHANNEL.title })).toBeInTheDocument();
    expect(screen.getByText("4.2M subscribers")).toBeInTheDocument();
    expect(screen.getByText(/Short documentaries about coastlines\./)).toBeInTheDocument();
  });

  it("links to the channel's own page off-site, with the new-tab warning", () => {
    view();

    const link = screen.getByRole("link", { name: /view on youtube/i });
    expect(link).toHaveAttribute("href", `https://www.youtube.com/channel/${CHANNEL.id}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent(/opens in a new tab/i);
  });

  it("keeps the avatar decorative so the heading names the channel once", () => {
    const { container } = view();

    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("omits the subscriber line when the count is hidden rather than showing zero", () => {
    view({ channel: { ...CHANNEL, subscriberCount: null } });

    expect(screen.queryByText(/subscribers?/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: CHANNEL.title })).toBeInTheDocument();
  });
});

describe("channel contract: uploads", () => {
  it("lists uploads under a named heading with one watch link per video", () => {
    view();

    expect(screen.getByRole("heading", { level: 2, name: "Recent uploads" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Recent uploads" });
    expect(within(list).getByRole("link", { name: UPLOAD.title })).toHaveAttribute(
      "href",
      `/watch/${UPLOAD.id}`,
    );
    expect(within(list).getByRole("link", { name: SECOND_UPLOAD.title })).toHaveAttribute(
      "href",
      `/watch/${SECOND_UPLOAD.id}`,
    );
  });

  it("keeps the identity card when the uploads call fails and reports the failure", () => {
    view({ uploads: [], uploadsUnavailable: true });

    expect(screen.getByRole("heading", { level: 1, name: CHANNEL.title })).toBeInTheDocument();
    expect(screen.getByText("Could not load recent uploads")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on youtube/i })).toBeInTheDocument();
  });

  it("shows an authored empty state for a channel with no visible uploads", () => {
    view({ uploads: [] });

    expect(screen.getByText("No uploads yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent uploads" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: CHANNEL.title })).toBeInTheDocument();
  });

  it.fails("exposes content tabs for the channel's sections", () => {
    // Spec control `content-tabs`: role=tab, one selected, six sections plus in-channel search.
    view();

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").length).toBeGreaterThanOrEqual(6);
  });

  it.fails("offers sort chips for the uploads view", () => {
    // Spec control `sort-chips`: latest / popular / oldest, one selected.
    view();

    expect(screen.getByRole("tablist", { name: /sort/i })).toBeInTheDocument();
  });
});

describe("channel contract: route failure", () => {
  it("offers a retry state when the channel lookup fails", async () => {
    readChannelMock.mockResolvedValue({ status: "error" });

    render(await ChannelPageContent({ params: Promise.resolve({ id: CHANNEL.id }) }));

    expect(screen.getByText("Could not load this channel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      `/channel/${CHANNEL.id}`,
    );
  });

  it("calls notFound for an unknown channel", async () => {
    readChannelMock.mockResolvedValue({ status: "not_found" });

    await expect(
      ChannelPageContent({ params: Promise.resolve({ id: "unknown-channel" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
