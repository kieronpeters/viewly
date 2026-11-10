import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push, routerState } = vi.hoisted(() => ({
  push: vi.fn(),
  routerState: { params: "q=cats" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(routerState.params),
}));

// `next/link` is replaced with a plain anchor so the component can render
// without an App Router mount; the tests assert the href rather than navigate.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { SearchFilters, SearchFiltersWithQuery } from "@/components/search/search-filters";
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchFilters as SearchFiltersState,
} from "@/shared/search-filters";

const ACTIVE_FILTERS: SearchFiltersState = {
  duration: "short",
  order: "viewCount",
  uploadDate: "week",
};

function renderFilters(overrides: Partial<ComponentProps<typeof SearchFilters>> = {}) {
  render(<SearchFilters query="cats" pageToken="CAoQAA" filters={ACTIVE_FILTERS} {...overrides} />);
}

function parsedHref(href: unknown): URL {
  return new URL(String(href), "https://viewly.test");
}

beforeEach(() => {
  push.mockReset();
  routerState.params = "q=cats";
});

describe("SearchFilters", () => {
  it("renders a labelled control for each filter", () => {
    renderFilters();

    expect(screen.getByRole("form", { name: "Search filters" })).toBeInTheDocument();
    expect(screen.getByLabelText("Duration")).toHaveValue("short");
    expect(screen.getByLabelText("Upload date")).toHaveValue("week");
    expect(screen.getByLabelText("Sort by")).toHaveValue("viewCount");
  });

  it("pushes a URL that keeps q, pageToken and the other filters when duration changes", async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.selectOptions(screen.getByLabelText("Duration"), "long");

    expect(push).toHaveBeenCalledTimes(1);
    const url = parsedHref(push.mock.calls[0]?.[0]);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("cats");
    expect(url.searchParams.get("pageToken")).toBe("CAoQAA");
    expect(url.searchParams.get("duration")).toBe("long");
    expect(url.searchParams.get("order")).toBe("viewCount");
    expect(url.searchParams.get("uploadDate")).toBe("week");
    // The select reflects the new value immediately, even before navigation.
    expect(screen.getByLabelText("Duration")).toHaveValue("long");
  });

  it("drops a filter from the URL when it returns to its default", async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.selectOptions(screen.getByLabelText("Sort by"), "relevance");

    const url = parsedHref(push.mock.calls[0]?.[0]);
    expect(url.searchParams.has("order")).toBe(false);
    expect(url.searchParams.get("duration")).toBe("short");
  });

  it("preserves q and pageToken when the upload date changes", async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.selectOptions(screen.getByLabelText("Upload date"), "month");

    const url = parsedHref(push.mock.calls[0]?.[0]);
    expect(url.searchParams.get("q")).toBe("cats");
    expect(url.searchParams.get("pageToken")).toBe("CAoQAA");
    expect(url.searchParams.get("uploadDate")).toBe("month");
  });

  it("offers a clear link that keeps q and pageToken but drops every filter", () => {
    renderFilters();

    const link = screen.getByRole("link", { name: "Clear filters" });
    const url = parsedHref(link.getAttribute("href"));

    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("cats");
    expect(url.searchParams.get("pageToken")).toBe("CAoQAA");
    expect(url.searchParams.has("duration")).toBe(false);
    expect(url.searchParams.has("order")).toBe(false);
    expect(url.searchParams.has("uploadDate")).toBe(false);
  });

  it("hides the clear link when every filter is at its default", () => {
    renderFilters({ filters: { ...DEFAULT_SEARCH_FILTERS } });

    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("keeps a plain GET form so the filters apply before hydration", () => {
    const { container } = render(
      <SearchFilters query="cats" pageToken="CAoQAA" filters={ACTIVE_FILTERS} />,
    );
    const form = screen.getByRole("form", { name: "Search filters" });

    expect(form).toHaveAttribute("action", "/search");
    expect(form).toHaveAttribute("method", "get");
    expect(container.querySelector('input[name="q"]')).toHaveValue("cats");
    expect(container.querySelector('input[name="pageToken"]')).toHaveValue("CAoQAA");
    expect(screen.getByLabelText("Duration")).toHaveAttribute("name", "duration");
    expect(screen.getByLabelText("Upload date")).toHaveAttribute("name", "uploadDate");
    expect(screen.getByLabelText("Sort by")).toHaveAttribute("name", "order");
  });

  it("applies the current selection from the Apply button", async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(push).toHaveBeenCalledTimes(1);
    const url = parsedHref(push.mock.calls[0]?.[0]);
    expect(url.searchParams.get("duration")).toBe("short");
    expect(url.searchParams.get("order")).toBe("viewCount");
    expect(url.searchParams.get("uploadDate")).toBe("week");
  });
});

describe("SearchFiltersWithQuery", () => {
  it("reads the active filters and page token from the URL", () => {
    routerState.params = "q=cats&duration=long&order=date&uploadDate=month&pageToken=TOKEN";

    render(<SearchFiltersWithQuery />);

    expect(screen.getByLabelText("Duration")).toHaveValue("long");
    expect(screen.getByLabelText("Upload date")).toHaveValue("month");
    expect(screen.getByLabelText("Sort by")).toHaveValue("date");
    expect(screen.getByRole("link", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("falls back to the defaults for an invalid URL value", () => {
    routerState.params = "q=cats&duration=tiny";

    render(<SearchFiltersWithQuery />);

    expect(screen.getByLabelText("Duration")).toHaveValue("any");
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});
