import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChannelDetail } from "@/shared/types";

import { WatchChannelCard } from "./watch-channel-card";

const CHANNEL: ChannelDetail = {
  id: "UCuAXFkgsw1L7xaCfnd5JJOw",
  title: "Rick Astley",
  avatarUrl: "https://yt3.ggpht.com/channel-high=s800",
  subscriberCount: 4_200_000,
  description: "The official Rick Astley channel.",
  uploadsPlaylistId: "UUuAXFkgsw1L7xaCfnd5JJOw",
};

const PROPS = {
  channel: CHANNEL,
  channelTitle: "Rick Astley",
  videoId: "dQw4w9WgXcQ",
};

describe("WatchChannelCard", () => {
  it("shows the channel avatar, name and formatted subscriber count", () => {
    const { container } = render(<WatchChannelCard {...PROPS} />);

    const avatar = container.querySelector("img");
    expect(avatar).not.toBeNull();
    // next/image routes the source through its loader; the original URL stays encoded.
    expect(avatar?.getAttribute("src")).toContain(
      encodeURIComponent("https://yt3.ggpht.com/channel-high=s800"),
    );

    expect(screen.getByText("Rick Astley")).toBeInTheDocument();
    expect(screen.getByText("4.2M subscribers")).toBeInTheDocument();
  });

  it("links to the channel on YouTube in a new tab, without an opener", () => {
    render(<WatchChannelCard {...PROPS} />);

    const link = screen.getByRole("link", { name: /view on youtube/i });

    expect(link).toHaveAttribute(
      "href",
      "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent(/opens in a new tab/i);
  });

  it("links the channel name to the internal channel page", () => {
    render(<WatchChannelCard {...PROPS} />);

    const link = screen.getByRole("link", { name: /channel: rick astley/i });

    expect(link).toHaveAttribute("href", "/channel/UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(link).not.toHaveAttribute("target");
  });

  it("keeps the internal link when channels.list failed but the snippet id is valid", () => {
    render(<WatchChannelCard {...PROPS} channel={null} channelId={CHANNEL.id} />);

    expect(screen.getByRole("link", { name: /channel: rick astley/i })).toHaveAttribute(
      "href",
      "/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
    );
    // The outbound link is unchanged and falls back to the video.
    expect(screen.getByRole("link", { name: /view on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("omits the internal link when no valid channel id is known", () => {
    render(<WatchChannelCard {...PROPS} channel={null} channelId="short" />);

    expect(screen.queryByRole("link", { name: /channel: /i })).not.toBeInTheDocument();
    // The rest of the card still renders with its outbound fallback.
    expect(screen.getByText("Rick Astley")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on youtube/i })).toBeInTheDocument();
  });

  it("draws the initial avatar when the API returned no avatar", () => {
    const { container } = render(
      <WatchChannelCard {...PROPS} channel={{ ...CHANNEL, avatarUrl: null }} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("R")).toBeInTheDocument();
    // The initial is decorative; the name beside it carries the identity.
    expect(screen.getByText("R")).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to the drawn icon when there is no name to initialise", () => {
    const { container } = render(<WatchChannelCard {...PROPS} channel={null} channelTitle="" />);

    expect(screen.getByText("Channel")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the snippet name and links to the video when the channel is unavailable", () => {
    render(<WatchChannelCard {...PROPS} channel={null} />);

    expect(screen.getByText("Rick Astley")).toBeInTheDocument();
    expect(screen.queryByText(/subscribers?/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("omits the subscriber line when the count was not published", () => {
    render(<WatchChannelCard {...PROPS} channel={{ ...CHANNEL, subscriberCount: null }} />);

    expect(screen.queryByText(/subscribers?/)).not.toBeInTheDocument();
    // The rest of the card still renders.
    expect(screen.getByText("Rick Astley")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on youtube/i })).toBeInTheDocument();
  });

  it("uses the singular noun for one subscriber", () => {
    render(<WatchChannelCard {...PROPS} channel={{ ...CHANNEL, subscriberCount: 1 }} />);

    expect(screen.getByText("1 subscriber")).toBeInTheDocument();
  });

  it("stays shrinkable inside a narrow (390px) header row", () => {
    const { container } = render(<WatchChannelCard {...PROPS} />);

    const card = container.querySelector('[data-slot="watch-channel-card"]');
    expect(card).toHaveClass("flex", "min-w-0", "max-w-full", "items-center");

    const avatar = container.querySelector("img");
    expect(avatar).toHaveClass("size-10", "shrink-0", "rounded-full");

    const name = screen.getByText("Rick Astley");
    expect(name).toHaveClass("truncate");
    expect(name.parentElement).toHaveClass("min-w-0");
  });

  it("keeps the outbound link a 44px touch target", () => {
    render(<WatchChannelCard {...PROPS} />);

    expect(screen.getByRole("link", { name: /view on youtube/i })).toHaveClass("min-h-11");
  });
});
