import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * Home flow contract — `docs/specs/home.md` / `home.json`, specVersion 0.1.0.
 *
 * Every assertion maps to a claim the spec makes about the home surface. Two
 * conventions keep the suite honest while Viewly catches up:
 *
 * - `it(...)` guards behaviour Viewly already satisfies. If Viewly regresses,
 *   CI fails.
 * - `it.fails(...)` marks a known parity gap from the spec. The test asserts the
 *   target behaviour, so it fails today; Vitest reports it as expected. When the
 *   behaviour is implemented the marker itself fails, which forces the author to
 *   promote it to `it(...)` and update the parity report. Gaps can therefore not
 *   be closed silently.
 *
 * Assertions are behavioural or structural. jsdom has no layout engine, so
 * appearance claims are guarded through the classes the stylesheet depends on,
 * and the parity report records that limitation.
 */

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

// The shell's account slot is an async Server Component; stub it in this tree.
vi.mock("@/components/layout/account-menu", () => ({
  AccountMenu: () => <span>Sign in</span>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(""),
}));

// `VideoCard` imports Server Actions at module load; the contract only needs them inert.
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

import { CategoryChips } from "@/components/home/category-chips";
import { VideoRow } from "@/components/home/video-row";
import { VideoRowSkeleton } from "@/components/home/video-row-skeleton";
import { AppShell } from "@/components/layout/app-shell";
import { SearchForm } from "@/components/search/search-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { VideoCard } from "@/components/video/video-card";
import type { VideoSummary } from "@/shared/types";

/** Hand-written fixture; the home surface never talks to the API in tests. */
const VIDEO: VideoSummary = {
  id: "contractVideo1",
  title: "A quietly useful documentary about coastlines",
  channelId: "contractChannel1",
  channelTitle: "Coastline Films",
  thumbnailUrl: "https://i.ytimg.com/vi/contractVideo1/hqdefault.jpg",
  publishedAt: "2026-10-01T09:00:00Z",
  durationSeconds: 754,
  viewCount: 1_500_000,
};

const CATEGORIES = [
  { slug: "music", name: "Music" },
  { slug: "documentary", name: "Documentary" },
];

function renderShell() {
  return render(
    <AppShell>
      <p>Page content</p>
    </AppShell>,
  );
}

describe("home contract: shell", () => {
  it("keeps the skip link as the first focus stop and points it at the main landmark", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.tab();

    const skipLink = screen.getByRole("link", { name: "Skip to content" });
    expect(skipLink).toHaveFocus();
    expect(skipLink).toHaveAttribute("href", "#main-content");

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("exposes exactly one main landmark and labelled navigation", () => {
    renderShell();

    expect(screen.getAllByRole("main")).toHaveLength(1);
    const navs = screen.getAllByRole("navigation", { name: "Primary" });
    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) expect(nav).toHaveAccessibleName("Primary");
  });
});

describe("home contract: search", () => {
  it("renders one named search landmark with a labelled search field", () => {
    render(<SearchForm />);

    expect(screen.getByRole("search", { name: "Search videos" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search videos" })).toBeInTheDocument();
  });

  it("focuses the search field when the / shortcut is pressed", () => {
    // Spec control `search-field`: "/" moves focus into the field.
    render(<SearchForm />);

    fireEvent.keyDown(document.body, { key: "/" });

    expect(screen.getByRole("searchbox", { name: "Search videos" })).toHaveFocus();
  });
});

describe("home contract: filter chips", () => {
  it.fails("presents home chips as a tablist with exactly one selected chip", () => {
    // Spec control `filter-chips`: role=tab, exactly one aria-selected, filters in place.
    render(<CategoryChips categories={CATEGORIES} />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(CATEGORIES.length);
    expect(
      screen.getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
  });
});

describe("home contract: video card", () => {
  it("makes the card a single link to its watch route named by the title", () => {
    render(<VideoCard video={VIDEO} />);

    expect(screen.getByRole("link", { name: VIDEO.title })).toHaveAttribute(
      "href",
      `/watch/${VIDEO.id}`,
    );
  });

  it("keeps the title to two lines and announces the duration", () => {
    render(<VideoCard video={VIDEO} />);

    const heading = screen.getByRole("heading", { level: 3, name: VIDEO.title });
    expect(heading).toHaveClass("line-clamp-2");

    const link = screen.getByRole("link", { name: VIDEO.title });
    expect(within(link).getByText("Duration", { exact: false })).toBeInTheDocument();
    expect(within(link).getByText("12:34")).toBeInTheDocument();
  });

  it("shows the channel and the view count", () => {
    render(<VideoCard video={VIDEO} />);

    expect(screen.getByText(VIDEO.channelTitle)).toBeInTheDocument();
    expect(screen.getByText(/1\.5M views/)).toBeInTheDocument();
  });

  it("switches its motion off when the viewer prefers reduced motion", () => {
    const { container } = render(<VideoCard video={VIDEO} />);

    const image = container.querySelector("img");
    expect(image).toHaveClass("motion-reduce:transition-none");
    expect(image).toHaveClass("motion-reduce:group-hover/link:scale-100");
  });

  it("shows how old the video is next to its view count", () => {
    // Spec `states.ready`: metadata is views *and* age.
    render(<VideoCard video={VIDEO} />);

    expect(screen.getByText(/\bago$/)).toBeInTheDocument();
  });

  it("opens a More actions menu and returns focus to the trigger on Escape", async () => {
    // Spec control `card-overflow`: menu in ~30-40ms, Escape in ~50ms, focus returned.
    const user = userEvent.setup();
    render(<VideoCard video={VIDEO} />);

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more actions/i })).toHaveFocus();
  });
});

describe("home contract: sections and states", () => {
  it("names the list of cards after its heading", () => {
    render(
      <>
        <h2 id="row-heading">Trending now</h2>
        <VideoRow labelledBy="row-heading" videos={[VIDEO]} />
      </>,
    );

    expect(screen.getByRole("list", { name: "Trending now" })).toBeInTheDocument();
  });

  it("announces a loading row and hides the placeholder blocks from assistive technology", () => {
    // Spec state `loading`: skeleton tiles while the feed resolves.
    const { container } = render(<VideoRowSkeleton title="Trending" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Trending");
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    for (const skeleton of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(skeleton).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("renders an authored empty state with a way out", () => {
    // Spec state `empty`: heading, guidance, and a recovery path.
    render(
      <EmptyState
        title="Nothing here yet"
        message="Watch something and this space fills up."
        action={<a href="/search">Search for a video</a>}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Nothing here yet" })).toBeInTheDocument();
    expect(screen.getByText("Watch something and this space fills up.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search for a video" })).toHaveAttribute(
      "href",
      "/search",
    );
  });

  it("announces a failure and offers retry", async () => {
    // Deliberate deviation from the spec: Viewly surfaces an error with recovery where
    // the observed surface silently shows an empty panel. Recorded in the parity report.
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<ErrorState message="Trending could not load." onRetry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Trending could not load.");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
