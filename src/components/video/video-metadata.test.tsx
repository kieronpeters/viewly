import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { VideoMetadata } from "@/components/video/video-metadata";
import type { VideoDetail } from "@/shared/types";

/**
 * Hand-written fixture shaped like a normalized `videos.list` item. The panel
 * never talks to the YouTube API, so the tests must not either.
 */
const VIDEO: VideoDetail = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_500_000_000,
  description: "The official video for Never Gonna Give You Up.",
};

/** Long enough to exceed the collapsed height estimate (~6 lines). */
const LONG_DESCRIPTION = Array.from(
  { length: 10 },
  (_, index) => `Paragraph ${index + 1}: the description keeps going.`,
).join("\n");

function metadataList(): HTMLElement {
  const term = screen.getByText("Channel");
  const list = term.closest("dl");

  if (list === null) {
    throw new Error("The metadata rows should live in a definition list.");
  }

  return list;
}

describe("VideoMetadata", () => {
  it("renders channel, published date, views and duration in a definition list", () => {
    render(<VideoMetadata video={VIDEO} />);

    expect(screen.getByRole("heading", { level: 2, name: "Video details" })).toBeInTheDocument();

    const list = metadataList();
    expect(within(list).getByText("Channel").tagName).toBe("DT");
    expect(within(list).getByText("Rick Astley")).toBeInTheDocument();
    expect(within(list).getByText("Published")).toBeInTheDocument();
    expect(within(list).getByText("Views")).toBeInTheDocument();
    expect(within(list).getByText("Duration")).toBeInTheDocument();
    expect(within(list).getByText("1.5B")).toBeInTheDocument();
    expect(within(list).getByText("3:33")).toBeInTheDocument();
  });

  it("keeps the published date machine-readable and deterministic", () => {
    render(<VideoMetadata video={VIDEO} />);

    const published = screen.getByText("25 Oct 2009");
    const time = published.closest("time");

    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("datetime", VIDEO.publishedAt);
  });

  it("omits missing fields instead of rendering blank rows", () => {
    render(
      <VideoMetadata
        video={{
          ...VIDEO,
          channelTitle: "",
          publishedAt: "not-a-date",
          viewCount: null,
          durationSeconds: null,
          description: "",
        }}
      />,
    );

    expect(screen.queryByText("Channel")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
    expect(screen.queryByText("Duration")).not.toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  });

  it("renders only the fields that have values", () => {
    render(<VideoMetadata video={{ ...VIDEO, viewCount: null, durationSeconds: null }} />);

    const list = metadataList();

    expect(within(list).getByText("Channel")).toBeInTheDocument();
    expect(within(list).getByText("Published")).toBeInTheDocument();
    expect(within(list).queryByText("Views")).not.toBeInTheDocument();
    expect(within(list).queryByText("Duration")).not.toBeInTheDocument();
  });

  it("collapses a long description and expands it from the button", async () => {
    const user = userEvent.setup();
    render(<VideoMetadata video={{ ...VIDEO, description: LONG_DESCRIPTION }} />);

    const showMore = screen.getByRole("button", { name: "Show more" });
    const contentId = showMore.getAttribute("aria-controls");
    const content = contentId === null ? null : document.getElementById(contentId);

    expect(showMore).toHaveAttribute("aria-expanded", "false");
    expect(content).not.toBeNull();
    expect(content).toHaveClass("max-h-40", "overflow-hidden");

    await user.click(showMore);

    const showLess = screen.getByRole("button", { name: "Show less" });
    expect(showLess).toHaveAttribute("aria-expanded", "true");
    expect(content).not.toHaveClass("max-h-40");
    expect(content).not.toHaveClass("overflow-hidden");

    await user.click(showLess);

    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(content).toHaveClass("max-h-40");
  });

  it("does not add a control for a description that fits", () => {
    render(<VideoMetadata video={VIDEO} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("only linkifies http and https URLs, leaving javascript: as text", () => {
    render(
      <VideoMetadata
        video={{
          ...VIDEO,
          description:
            "Open javascript:alert(1) or ftp://example.com/file and visit https://example.com/docs for more.",
        }}
      />,
    );

    expect(screen.queryByRole("link", { name: /javascript/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ftp:/i })).not.toBeInTheDocument();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/ftp:\/\/example\.com\/file/)).toBeInTheDocument();

    const safeLink = screen.getByRole("link", { name: "https://example.com/docs" });
    expect(safeLink).toHaveAttribute("href", "https://example.com/docs");
    expect(safeLink).toHaveAttribute("target", "_blank");
    expect(safeLink).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("preserves line breaks without rendering HTML", () => {
    render(
      <VideoMetadata
        video={{ ...VIDEO, description: 'First line\nSecond line <script>alert("x")</script>' }}
      />,
    );

    const paragraph = screen.getByText(/First line/);

    expect(paragraph.tagName).toBe("P");
    expect(paragraph).toHaveClass("whitespace-pre-line");
    expect(paragraph.textContent).toBe('First line\nSecond line <script>alert("x")</script>');
    expect(paragraph.querySelector("br")).toBeNull();
    expect(paragraph.querySelector("script")).toBeNull();
  });
});
