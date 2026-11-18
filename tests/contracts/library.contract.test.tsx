import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The tabs and shelf import the server-only feature barrel; the components
// themselves are pure, so the guard is stubbed for this contract.
vi.mock("server-only", () => ({}));

import { ContinueWatchingShelf } from "@/features/progress/continue-watching-section";
import { LibraryTabs, resolveLibraryTab } from "@/app/library/library-tabs";

const COUNTS = { favourites: 2, watchLater: 1, history: 3, playlists: 4 };

function renderTabs(activeTab: "favourites" | "watch-later" | "history" | "playlists") {
  return render(<LibraryTabs activeTab={activeTab} counts={COUNTS} />);
}

/**
 * Contract for `docs/specs/library.md`.
 *
 * The library's promise is URL-addressed tabs with a single current page and a
 * shelf that stays out of the way when there is nothing in progress.
 */
describe("library contract: tabs", () => {
  it("renders the four sections with canonical hrefs", () => {
    renderTabs("history");

    const links = screen.getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/library",
      "/library?tab=watch-later",
      "/library?tab=history",
      "/library?tab=playlists",
    ]);
  });

  it("marks exactly the active tab with aria-current=page", () => {
    renderTabs("history");

    const links = screen.getAllByRole("link");
    const current = links.filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(links[2]).toHaveAttribute("aria-current", "page");
  });

  it("falls back to favourites for unknown or duplicated tab values", () => {
    expect(resolveLibraryTab(undefined)).toBe("favourites");
    expect(resolveLibraryTab("music")).toBe("favourites");
    expect(resolveLibraryTab(["favourites", "history"])).toBe("favourites");
    expect(resolveLibraryTab("watch-later")).toBe("watch-later");
  });
});

describe("library contract: continue watching", () => {
  it("renders nothing when there is nothing in progress", () => {
    const { container } = render(<ContinueWatchingShelf items={[]} titleId="shelf-heading" />);

    expect(container).toBeEmptyDOMElement();
  });
});
