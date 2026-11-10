import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The cards import Server Actions; the row test only needs their markup.
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));

import { VideoRow } from "@/components/home/video-row";
import type { VideoSummary } from "@/shared/types";

const VIDEO: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 213,
  viewCount: 1_500_000,
};

describe("VideoRow", () => {
  it("fades streamed content in when the skeleton is replaced", () => {
    render(<VideoRow labelledBy="row-heading" videos={[VIDEO]} />);

    // The grid receives the shared reveal animation; it is opacity-only, so the
    // cards never move as the placeholder gives way to real content. The
    // global reduced-motion rule collapses the duration.
    expect(screen.getByRole("list")).toHaveClass("content-in");
  });
});
