import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The card's save controls import Server Actions; they stay inert in jsdom.
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));
vi.mock("@/features/library/playlist-actions", () => ({
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
}));

import { VideoCard } from "@/components/video/video-card";
import type { VideoSummary } from "@/shared/types";

const VIDEO: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: 200,
  viewCount: 1_500_000,
};

describe("VideoCard progress bar", () => {
  it("shows an in-progress bar with an accessible percentage", () => {
    render(<VideoCard video={VIDEO} progress={{ positionSeconds: 42, durationSeconds: 200 }} />);

    const bar = screen.getByRole("progressbar", { name: "Watch progress" });

    expect(bar).toHaveAttribute("aria-valuenow", "21");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar.firstElementChild).toHaveStyle({ width: "21%" });
  });

  it("rounds the bar width down to a whole percent", () => {
    render(<VideoCard video={VIDEO} progress={{ positionSeconds: 42, durationSeconds: 100 }} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it.each([
    ["just started", { positionSeconds: 4, durationSeconds: 200 }],
    ["effectively finished", { positionSeconds: 191, durationSeconds: 200 }],
    ["zero progress", { positionSeconds: 0, durationSeconds: 200 }],
    ["a broken duration", { positionSeconds: 42, durationSeconds: 0 }],
  ])("renders no bar for %s", (_label, progress) => {
    render(<VideoCard video={VIDEO} progress={progress} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders no bar when progress is omitted or null", () => {
    const { rerender } = render(<VideoCard video={VIDEO} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rerender(<VideoCard video={VIDEO} progress={null} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
