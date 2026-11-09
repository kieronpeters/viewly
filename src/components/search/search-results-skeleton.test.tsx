import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";

/**
 * The streaming fallback for `/search`.
 *
 * Users see placeholders while the server component awaits YouTube; assistive
 * technology should hear one "loading" announcement rather than a grid of
 * meaningless boxes, and there must be nothing to tab into or click before the
 * real results arrive.
 */
describe("SearchResultsSkeleton", () => {
  it("announces that results are loading", () => {
    render(<SearchResultsSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading search results…");
  });

  it("keeps every placeholder out of the accessibility tree", () => {
    const { container } = render(<SearchResultsSkeleton />);

    const placeholders = container.querySelectorAll('[data-slot="skeleton"]');

    expect(placeholders.length).toBeGreaterThan(0);
    for (const placeholder of placeholders) {
      expect(placeholder).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("offers no links or buttons before the results exist", () => {
    render(<SearchResultsSkeleton />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
