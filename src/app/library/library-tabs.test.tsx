import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// `next/link` is replaced with a plain anchor so the keyboard test can assert
// that Enter on a focused tab follows its href without mounting the App Router.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        navigateMock(href);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

import { LibraryTabs, libraryTabHref, resolveLibraryTab } from "./library-tabs";

/** Totals as `countLibraryEntries` reports them. */
const COUNTS = {
  favourites: 3,
  watchLater: 1,
  history: 12,
  playlists: 2,
};

/** The tab bar as the page renders it, with no client state involved. */
function renderTabs(activeTab: "favourites" | "watch-later" | "history" | "playlists") {
  render(<LibraryTabs activeTab={activeTab} counts={COUNTS} />);

  return screen.getByRole("navigation", { name: "Library sections" });
}

describe("resolveLibraryTab", () => {
  it.each([
    [undefined, "favourites"],
    ["favourites", "favourites"],
    ["watch-later", "watch-later"],
    ["playlists", "playlists"],
    ["history", "history"],
    ["", "favourites"],
    [[], "favourites"],
    [["favourites", "history"], "favourites"],
    [["watch-later", "favourites"], "watch-later"],
    [["playlists", "favourites"], "playlists"],
    ["HISTORY", "favourites"],
  ])("maps %j to %s", (value, expected) => {
    expect(resolveLibraryTab(value)).toBe(expected);
  });
});

describe("libraryTabHref", () => {
  it("keeps the default tab on the bare library URL", () => {
    expect(libraryTabHref("favourites")).toBe("/library");
    expect(libraryTabHref("watch-later")).toBe("/library?tab=watch-later");
    expect(libraryTabHref("history")).toBe("/library?tab=history");
    expect(libraryTabHref("playlists")).toBe("/library?tab=playlists");
  });
});

describe("LibraryTabs", () => {
  it("renders the four tabs in display order", () => {
    const nav = renderTabs("favourites");

    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/library",
      "/library?tab=watch-later",
      "/library?tab=history",
      "/library?tab=playlists",
    ]);
  });

  it.each([
    ["favourites", "/library"],
    ["watch-later", "/library?tab=watch-later"],
    ["history", "/library?tab=history"],
    ["playlists", "/library?tab=playlists"],
  ] as const)("marks only the %s tab as the current page", (activeTab, href) => {
    const nav = renderTabs(activeTab);

    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", href);
  });

  it("shows each tab's count in its accessible name", () => {
    const nav = renderTabs("favourites");

    expect(within(nav).getByRole("link", { name: "Favourites (3)" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Watch later (1)" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "History (12)" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Playlists (2)" })).toBeInTheDocument();
  });

  it("is keyboard reachable and follows the focused tab on Enter", async () => {
    const user = userEvent.setup();

    renderTabs("favourites");

    await user.tab();
    expect(screen.getByRole("link", { name: "Favourites (3)" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Watch later (1)" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(navigateMock).toHaveBeenCalledWith("/library?tab=watch-later");
  });

  it("shows a focus-visible ring on every tab", () => {
    const nav = renderTabs("favourites");

    for (const link of within(nav).getAllByRole("link")) {
      expect(link).toHaveClass("focus-visible:ring-2");
    }
  });

  it("wraps the row instead of scrolling, so 360px cannot overflow", () => {
    // jsdom does no layout, so this guards the strategy the CSS relies on: the
    // row wraps, each pill keeps a 44px target, and only the label is nowrap.
    const nav = renderTabs("favourites");
    const list = within(nav).getByRole("list");

    expect(nav).not.toHaveClass("overflow-x-auto");
    expect(list).toHaveClass("flex-wrap");
    expect(list).not.toHaveClass("overflow-hidden");

    for (const link of within(nav).getAllByRole("link")) {
      expect(link).toHaveClass("min-h-11");
      expect(link).toHaveClass("max-w-full");
    }

    for (const label of ["Favourites", "Watch later", "History", "Playlists"]) {
      expect(within(nav).getByText(label)).toHaveClass("whitespace-nowrap");
    }
  });
});
