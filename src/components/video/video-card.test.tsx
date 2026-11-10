import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { toggleFavouriteMock, toggleWatchLaterMock } = vi.hoisted(() => ({
  toggleFavouriteMock: vi.fn(),
  toggleWatchLaterMock: vi.fn(),
}));

// The save controls import the Server Actions; the card test only needs them to
// be inert. The actions themselves are covered in `features/library`.
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: toggleFavouriteMock,
  toggleWatchLater: toggleWatchLaterMock,
}));
vi.mock("@/features/library/playlist-actions", () => ({
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
}));

import { VideoCard } from "@/components/video/video-card";
import { normalizeSearchResponse } from "@/shared/youtube";
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

const PLAYLISTS = [
  { id: "playlist-road-trip", name: "Road trip" },
  { id: "playlist-lofi", name: "Lofi beats" },
];

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

  it("renders a normalized title containing an apostrophe as plain text", () => {
    const page = normalizeSearchResponse({
      items: [
        {
          id: { videoId: VIDEO_FIXTURE.id },
          snippet: {
            title: "DON&#39;T LET THE HUMANS IN",
            channelId: VIDEO_FIXTURE.channelId,
            channelTitle: "Mister &amp; Bbbi",
            publishedAt: VIDEO_FIXTURE.publishedAt,
            thumbnails: { high: { url: VIDEO_FIXTURE.thumbnailUrl } },
          },
        },
      ],
    });
    const video = page.items[0]!;

    render(<VideoCard video={video} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "DON'T LET THE HUMANS IN" }),
    ).toBeInTheDocument();
    expect(screen.getByText("DON'T LET THE HUMANS IN")).toBeInTheDocument();
    expect(screen.getByText("Mister & Bbbi")).toBeInTheDocument();
    expect(screen.queryByText(/&#39;|&amp;/)).not.toBeInTheDocument();
  });

  it("does not nest interactive elements inside the link", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    const link = screen.getByRole("link");

    expect(within(link).queryAllByRole("link")).toHaveLength(0);
    expect(within(link).queryAllByRole("button")).toHaveLength(0);
    expect(link.querySelectorAll("a, button, input, select, textarea")).toHaveLength(0);
  });

  it("renders the favourite control as a sibling of the card link", () => {
    const { container } = render(<VideoCard video={VIDEO_FIXTURE} isFavourite />);

    const card = container.querySelector('[data-slot="video-card"]');
    const link = screen.getByRole("link", { name: /Never Gonna Give You Up/ });
    const button = screen.getByRole("button", { name: "Remove from favourites" });

    // The wrapper owns both tab stops; the button is never a descendant of the
    // anchor, which is what keeps the markup valid and the control reachable.
    expect(card).not.toBeNull();
    expect(card).toContainElement(link);
    expect(card).toContainElement(button);
    expect(link).not.toContainElement(button);
    expect(within(link).queryAllByRole("button")).toHaveLength(0);
    expect(link.querySelectorAll("a, button")).toHaveLength(0);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("renders an unsaved favourite control when the caller opts in with false", () => {
    render(<VideoCard video={VIDEO_FIXTURE} isFavourite={false} />);

    expect(screen.getByRole("button", { name: "Add to favourites" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("omits the favourite control unless the caller opts in", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders both save controls as siblings of the card link in a stable order", () => {
    const { container } = render(<VideoCard video={VIDEO_FIXTURE} isFavourite isWatchLater />);

    const card = container.querySelector('[data-slot="video-card"]');
    const link = screen.getByRole("link", { name: /Never Gonna Give You Up/ });
    const controls = container.querySelector<HTMLElement>('[data-slot="video-card-controls"]');
    const buttons = screen.getAllByRole("button");

    expect(card).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(card).toContainElement(link);
    expect(card).toContainElement(controls);
    expect(link).not.toContainElement(controls);
    // The wrapper owns the tab stops: link, favourite, watch later.
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove from favourites",
      "Remove from Watch Later",
    ]);
    expect(within(link).queryAllByRole("button")).toHaveLength(0);
    expect(link.querySelectorAll("a, button")).toHaveLength(0);
    expect(buttons[0].parentElement?.parentElement).toBe(controls);
    expect(buttons[1].parentElement?.parentElement).toBe(controls);
  });

  it("renders only the watch-later control when only its state is passed", () => {
    render(<VideoCard video={VIDEO_FIXTURE} isWatchLater={false} />);

    expect(screen.getByRole("button", { name: "Add to Watch Later" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("button", { name: /favourites/i })).not.toBeInTheDocument();
  });

  it("keeps the two controls visually separated", () => {
    const { container } = render(<VideoCard video={VIDEO_FIXTURE} isFavourite isWatchLater />);

    expect(container.querySelector('[data-slot="video-card-controls"]')).toHaveClass(
      "flex",
      "gap-1.5",
    );
  });

  it("keeps the decorative thumbnail out of the link's accessible name", () => {
    const { container } = render(<VideoCard video={VIDEO_FIXTURE} />);

    const link = screen.getByRole("link", { name: /Never Gonna Give You Up/ });
    const image = container.querySelector("img");

    // The title is already the adjacent `<h3>` inside the same link. A
    // non-empty `alt` would repeat it, so the image is decorative and is not
    // exposed as an `img` at all.
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(within(link).queryByRole("img")).not.toBeInTheDocument();
    // The link is named by the title once, not by the whole text block.
    expect(link).toHaveAccessibleName(VIDEO_FIXTURE.title);
    // The channel, views and duration stay part of the link's text content.
    expect(within(link).getByText(VIDEO_FIXTURE.channelTitle)).toBeInTheDocument();
    expect(within(link).getByText("1.5M views")).toBeInTheDocument();
    expect(within(link).getByText("3:33")).toBeInTheDocument();
    // jsdom cannot decode the optimizer URL, so only the encoded source is asserted.
    expect(image?.getAttribute("src")).toContain(encodeURIComponent(VIDEO_FIXTURE.thumbnailUrl));
    // Lock the responsive contract: a sized `fill` image inside a fixed 16:9 box.
    expect(image).toHaveAttribute(
      "sizes",
      "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
    );
    expect(image?.parentElement).toHaveClass("relative", "aspect-video");
  });

  it("names the video with a level-three heading under the row heading", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    expect(
      screen.getByRole("heading", { level: 3, name: VIDEO_FIXTURE.title }),
    ).toBeInTheDocument();
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

  it("keeps discovery cards free of the playlist picker unless the caller opts in", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    expect(screen.queryByRole("button", { name: "Add to playlist" })).not.toBeInTheDocument();
  });

  it("renders the playlist picker as the last sibling control", () => {
    const { container } = render(
      <VideoCard
        video={VIDEO_FIXTURE}
        isFavourite
        isWatchLater
        showPlaylistPicker
        playlists={PLAYLISTS}
      />,
    );

    const link = screen.getByRole("link", { name: /Never Gonna Give You Up/ });
    const controls = container.querySelector<HTMLElement>('[data-slot="video-card-controls"]');
    const buttons = screen.getAllByRole("button");

    expect(controls).not.toBeNull();
    expect(link).not.toContainElement(controls);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove from favourites",
      "Remove from Watch Later",
      "Add to playlist",
    ]);
    expect(buttons[2]).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the picker inline and lists the playlists", () => {
    render(<VideoCard video={VIDEO_FIXTURE} showPlaylistPicker playlists={PLAYLISTS} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to playlist" }));

    const panel = screen.getByRole("group", { name: "Add to playlist" });

    expect(panel).toHaveAttribute("data-slot", "playlist-picker-panel");
    expect(within(panel).getByRole("button", { name: "Road trip" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Lofi beats" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "New playlist" })).toBeInTheDocument();
  });

  it("reaches the link and every control in DOM order from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <VideoCard
        video={VIDEO_FIXTURE}
        isFavourite
        isWatchLater
        showPlaylistPicker
        playlists={PLAYLISTS}
      />,
    );

    const link = screen.getByRole("link", { name: /Never Gonna Give You Up/ });

    await user.tab();
    expect(link).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Remove from favourites" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Remove from Watch Later" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Add to playlist" })).toHaveFocus();
  });

  it("does not add the save controls to a discovery card's tab stops", async () => {
    const user = userEvent.setup();
    render(<VideoCard video={VIDEO_FIXTURE} />);

    await user.tab();
    expect(screen.getByRole("link", { name: /Never Gonna Give You Up/ })).toHaveFocus();

    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it("uses the shared focus ring on the card link", () => {
    render(<VideoCard video={VIDEO_FIXTURE} />);

    expect(screen.getByRole("link", { name: /Never Gonna Give You Up/ })).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "focus-visible:ring-offset-2",
      "focus-visible:ring-offset-background",
    );
  });

  it("lifts the card and zooms the thumbnail on hover without moving the grid", () => {
    const { container } = render(<VideoCard video={VIDEO_FIXTURE} />);

    const link = screen.getByRole("link", { name: /Never Gonna Give You Up/ });
    const image = container.querySelector("img");

    // The lift is a translate on the card (no layout change), and the hover
    // treatment is switched off entirely for reduced-motion viewers.
    expect(link).toHaveClass("hover:-translate-y-0.5", "hover:bg-surface-elevated");
    expect(link).toHaveClass("motion-reduce:hover:translate-y-0");
    expect(link).toHaveClass("motion-reduce:transition-none");
    expect(image).toHaveClass("group-hover/card:scale-[1.03]");
    expect(image).toHaveClass("motion-reduce:group-hover/card:scale-100");
  });

  it("keeps the save confirmations mounted but visually empty", () => {
    render(<VideoCard video={VIDEO_FIXTURE} isFavourite isWatchLater />);

    const regions = screen.getAllByRole("status");

    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region).toBeEmptyDOMElement();
      expect(region).toHaveClass("pointer-events-none", "absolute", "opacity-0");
    }
  });
});
