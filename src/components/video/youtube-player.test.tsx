import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { YoutubePlayer } from "@/components/video/youtube-player";

/**
 * Hand-written fixture: the player only builds URLs from ids and titles, so
 * tests never touch the YouTube API or the network.
 */
const VIDEO = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
};

const EMBED_URL = `https://www.youtube-nocookie.com/embed/${VIDEO.id}?rel=0`;
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO.id}`;

describe("YoutubePlayer", () => {
  it("embeds the official nocookie player for the video id", () => {
    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    const iframe = document.querySelector("iframe");

    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute("src", EMBED_URL);
    // Never a custom media element: the official player is the only source.
    expect(document.querySelector("video")).toBeNull();
  });

  it("labels the iframe with the video title", () => {
    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    const iframe = document.querySelector("iframe");

    expect(iframe).toHaveAccessibleName(
      new RegExp(VIDEO.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    expect(iframe?.getAttribute("title")).toContain(VIDEO.title);
  });

  it("exposes a visible fallback link to the watch page", () => {
    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    const link = screen.getByRole("link", { name: /open on youtube/i });

    expect(link).toHaveAttribute("href", WATCH_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toBeVisible();
  });

  it("does not autoplay and only keeps the permissions playback needs", () => {
    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    const iframe = document.querySelector("iframe");
    const src = iframe?.getAttribute("src") ?? "";
    const allow = iframe?.getAttribute("allow") ?? "";

    expect(src).not.toContain("autoplay");
    expect(src).not.toContain("mute");
    expect(allow).not.toContain("autoplay");
    expect(allow).toBe("accelerometer; encrypted-media; gyroscope; picture-in-picture");
  });

  it("reserves a rounded 16:9 box so the embed does not shift the layout", () => {
    render(<YoutubePlayer videoId={VIDEO.id} title={VIDEO.title} />);

    const iframe = document.querySelector("iframe");
    const frame = iframe?.parentElement;

    expect(frame).toHaveClass(
      "relative",
      "aspect-video",
      "w-full",
      "rounded-xl",
      "overflow-hidden",
    );
    expect(iframe).toHaveAttribute("loading", "lazy");
    expect(iframe).toHaveAttribute("allowfullscreen");
  });
});
