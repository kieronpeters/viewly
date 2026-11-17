import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a Server Component graph; these component contracts are not one.
vi.mock("server-only", () => ({}));

/**
 * Watch flow contract — `docs/specs/watch.md` / `watch.json`, specVersion 0.1.0.
 *
 * This flow has no `it.fails` markers: the route-level gaps recorded in the parity
 * report (restricted-video panel, ads, player-internal error surface) need a full
 * server-component graph to exercise and are tracked there instead of being faked here.
 * `it(...)` guards the layout and description behaviour Viewly already meets.
 */

import { WatchDescription } from "@/app/watch/[videoId]/watch-description";
import { WatchStageLayout } from "@/app/watch/[videoId]/watch-stage-layout";
import { WatchTheaterProvider } from "@/app/watch/[videoId]/watch-theater";
import { WatchSuggestionsSkeleton } from "@/app/watch/[videoId]/watch-suggestions";
import type { VideoDetail } from "@/shared/types";

const LONG_DESCRIPTION = [
  "A documentary about coastlines and the people who read them.",
  "The film follows three communities across a year of tides, storms and quiet mornings.",
  "Chapters and links are included for reference.",
  "This paragraph exists to make the description longer than the collapsed budget so the expander renders.",
].join("\n\n");

const VIDEO: VideoDetail = {
  id: "contractWatch1",
  title: "Tides and the people who read them",
  channelId: "contractChannel1",
  channelTitle: "Coastline Films",
  thumbnailUrl: "https://i.ytimg.com/vi/contractWatch1/hqdefault.jpg",
  publishedAt: "2026-10-01T09:00:00Z",
  durationSeconds: 754,
  viewCount: 1_500_000,
  description: LONG_DESCRIPTION,
};

describe("watch contract: stage layout", () => {
  it("puts the player content in the primary column and labels the rail", () => {
    render(
      <WatchTheaterProvider>
        <WatchStageLayout rail={<p>Related items</p>}>
          <p>Player column</p>
        </WatchStageLayout>
      </WatchTheaterProvider>,
    );

    expect(screen.getByText("Player column")).toBeInTheDocument();
    const rail = screen.getByRole("complementary", { name: "Suggested videos" });
    expect(rail).toHaveTextContent("Related items");
    expect(
      screen.getByText("Player column").closest("[data-slot='watch-stage-layout']"),
    ).toHaveAttribute("data-theater", "false");
  });
});

describe("watch contract: description", () => {
  it("is a named region with views, duration and publish date", () => {
    render(<WatchDescription video={VIDEO} />);

    const region = screen.getByRole("region", { name: "Description" });
    expect(region).toHaveTextContent("1.5M views");
    expect(region).toHaveTextContent("12:34");
    expect(region).toHaveTextContent(/Published/);
  });

  it("collapses a long description behind an expander", () => {
    render(<WatchDescription video={VIDEO} />);

    expect(screen.getByRole("button", { name: /show more/i })).toBeInTheDocument();
  });

  it("says so plainly when the video has no description", () => {
    render(<WatchDescription video={{ ...VIDEO, description: "" }} />);

    expect(screen.getByText("No description was provided for this video.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
  });
});

describe("watch contract: loading rail", () => {
  it("announces the wait and keeps the placeholder geometry decorative", () => {
    const { container } = render(<WatchSuggestionsSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading up next");
    const decorative = container.querySelector('[aria-hidden="true"]');
    expect(decorative).not.toBeNull();
    expect(decorative?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
