import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("q=cats"),
}));

import { SearchForm, SearchFormWithQuery } from "@/components/search/search-form";
import { buildSearchHref } from "@/components/search/search-url";

/** Parses a pushed href so assertions do not depend on `+` vs `%20`. */
function parseHref(href: string): URL {
  return new URL(href, "https://viewly.test");
}

/**
 * The form landmark is also labelled "Search videos", so target the field by
 * its role (`<input type="search">` is a searchbox) rather than by label text.
 */
function getSearchbox() {
  return screen.getByRole("searchbox", { name: "Search videos" });
}

beforeEach(() => {
  push.mockReset();
});

describe("SearchForm", () => {
  it("navigates to a trimmed /search?q= URL on submit", async () => {
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(getSearchbox(), "  rick astley  ");
    await user.click(screen.getByRole("button", { name: /search/i }));

    expect(push).toHaveBeenCalledTimes(1);
    const url = parseHref(push.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("rick astley");
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("submits on Enter as well as on the button", async () => {
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(getSearchbox(), "cats{Enter}");

    expect(push).toHaveBeenCalledTimes(1);
    expect(parseHref(push.mock.calls[0]?.[0] as string).searchParams.get("q")).toBe("cats");
  });

  it("does not navigate for an empty or whitespace-only query", async () => {
    const user = userEvent.setup();
    render(<SearchForm />);
    const input = getSearchbox();

    await user.type(input, "   ");
    await user.keyboard("{Enter}");

    expect(push).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it("encodes characters that are unsafe in a query string", async () => {
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(getSearchbox(), "cats & dogs?");
    await user.keyboard("{Enter}");

    expect(parseHref(push.mock.calls[0]?.[0] as string).searchParams.get("q")).toBe("cats & dogs?");
  });

  it("prefills the input from initialQuery", () => {
    render(<SearchForm initialQuery="cats" />);

    expect(getSearchbox()).toHaveValue("cats");
  });

  it("prefills from the URL when wrapped in SearchFormWithQuery", () => {
    render(<SearchFormWithQuery />);

    expect(getSearchbox()).toHaveValue("cats");
  });

  it("builds hrefs with an optional page token", () => {
    expect(buildSearchHref("rick astley")).toBe("/search?q=rick+astley");
    expect(buildSearchHref("rick astley", "CAoQAA")).toBe("/search?q=rick+astley&pageToken=CAoQAA");
  });
});
