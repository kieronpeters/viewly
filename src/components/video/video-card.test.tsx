import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VideoCard } from "@/components/video/video-card";
import type { VideoSummary } from "@/shared/types";

/**
 * Hand-written fixture: the card never talks to the YouTube API, so tests must
 * not either. Values mirror a real `search.list` item normalized by
 * `shared/youtube.ts`.
 */
const VIDEO_FIXTURE: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_500_000,
};

describe("VideoCard", () => {
  it("makes the whole card one link to the watch page", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    const link = screen.getByRole("link", { name: /Never Gonna Give You Up/ });

    expect(link).toHaveAttribute("href", "/watch/dQw4w9WgXcQ");
    expect(within(link).getByText(VIDEO_FIXTURE.title)).toBeInTheDocument();
    expect(within(link).getByText(VIDEO_FIXTURE.channelTitle)).toBeInTheDocument();
    expect(within(link).getByText("1.5M views")).toBeInTheDocument();
    expect(within(link).getByText("3:33")).toBeInTheDocument();
  });

  it("does not nest interactive elements inside the link", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    const link = screen.getByRole("link");

    expect(within(link).queryAllByRole("link")).toHaveLength(0);
    expect(within(link).queryAllByRole("button")).toHaveLength(0);
    expect(link.querySelectorAll("a, button, input, select, textarea")).toHaveLength(0);
  });

  it("renders the thumbnail with the title as its alt text", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    const image = screen.getByRole("img", { name: VIDEO_FIXTURE.title });

    expect(image).toHaveAttribute("alt", VIDEO_FIXTURE.title);
    // jsdom cannot decode the optimizer URL, so only the encoded source is asserted.
    expect(image.getAttribute("src")).toContain(encodeURIComponent(VIDEO_FIXTURE.thumbnailUrl));
    // Lock the responsive contract: a sized `fill` image inside a fixed 16:9 box.
    expect(image).toHaveAttribute(
      "sizes",
      "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
    );
    expect(image.parentElement).toHaveClass("relative", "aspect-video");
  });

  it("omits the duration badge when the duration is null", () => {
    render(<VideoCard video={{ ...VIDEO_FIXTURE, durationSeconds: null }} />);

    expect(screen.queryByText("3:33")).not.toBeInTheDocument();
    expect(screen.queryByText(/duration/i)).not.toBeInTheDocument();
  });

  it("omits the view count when it is null", () => {
    render(<VideoCard video={{ ...VIDEO_FIXTURE, viewCount: null }} />);

    expect(screen.queryByText(/views?/)).not.toBeInTheDocument();
  });

  it("omits an empty channel title instead of rendering a blank line", () => {
    render(<VideoCard video={{ ...VIDEO_FIXTURE, channelTitle: "" }} />);

    expect(screen.queryByText("Rick Astley")).not.toBeInTheDocument();
    expect(screen.getByText(VIDEO_FIXTURE.title)).toBeInTheDocument();
  });
});
