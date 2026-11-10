import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listContinueWatchingVideosMock } = vi.hoisted(() => ({
  listContinueWatchingVideosMock: vi.fn(),
}));

// The section's only server dependency is the local read. Replacing it keeps
// this suite in jsdom: no SQLite handle and no `connection()` call.
vi.mock("./continue-watching", () => ({
  listContinueWatchingVideos: listContinueWatchingVideosMock,
}));

import type { ContinueWatchingItem } from "./continue-watching";
import { ContinueWatchingSection } from "./continue-watching-section";

function item(
  id: string,
  title: string,
  positionSeconds: number,
  durationSeconds = 60,
): ContinueWatchingItem {
  return {
    video: {
      id,
      title,
      channelId: "",
      channelTitle: "Channel",
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      publishedAt: "",
      durationSeconds,
      viewCount: null,
    },
    progress: { positionSeconds, durationSeconds },
  };
}

const ITEMS = [item("video000001", "First in progress", 30), item("video000002", "Second", 15)];

beforeEach(() => {
  listContinueWatchingVideosMock.mockReset();
  listContinueWatchingVideosMock.mockResolvedValue(ITEMS);
});

describe("ContinueWatchingSection", () => {
  it("renders a home row with a progress bar on every card", async () => {
    render(await ContinueWatchingSection({ titleId: "home-continue-watching-heading" }));

    expect(
      screen.getByRole("heading", { name: "Continue watching", level: 2 }),
    ).toBeInTheDocument();

    const region = screen.getByRole("region", { name: "Continue watching" });

    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/watch/video000001", "/watch/video000002"]);

    const bars = screen.getAllByRole("progressbar", { name: "Watch progress" });
    expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["50", "25"]);
  });

  it("renders the library variant as a grid with the same cards", async () => {
    render(
      await ContinueWatchingSection({
        titleId: "library-continue-watching-heading",
        layout: "grid",
      }),
    );

    const region = screen.getByRole("region", { name: "Continue watching" });
    const list = within(region).getByRole("list");

    expect(within(list).getAllByRole("listitem")).toHaveLength(ITEMS.length);
    expect(within(list).getAllByRole("link")).toHaveLength(ITEMS.length);
    expect(screen.getAllByRole("progressbar", { name: "Watch progress" })).toHaveLength(
      ITEMS.length,
    );
  });

  it("renders nothing when no video is in progress", async () => {
    listContinueWatchingVideosMock.mockResolvedValue([]);

    const { container } = render(
      await ContinueWatchingSection({ titleId: "home-continue-watching-heading" }),
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("heading", { name: "Continue watching" })).toBeNull();
  });

  it("hides the shelf instead of failing the page when the read fails", async () => {
    listContinueWatchingVideosMock.mockRejectedValue(new Error("database unavailable"));

    const { container } = render(
      await ContinueWatchingSection({ titleId: "home-continue-watching-heading" }),
    );

    expect(container).toBeEmptyDOMElement();
  });
});
