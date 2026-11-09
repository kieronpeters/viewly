import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The hero embeds the real `SearchForm`, which is a client component.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The page is a static shell around one async row per category. Mocking the
// feature entry keeps this test about page composition: hero, search form and
// one row per home category, each already inside its own Suspense boundary.
vi.mock("@/features/home", () => ({
  getHomeCategories: () => [
    { slug: "music", name: "Music" },
    { slug: "gaming", name: "Gaming" },
    { slug: "technology", name: "Technology" },
  ],
  getAllCategories: () => [
    { slug: "music", name: "Music" },
    { slug: "gaming", name: "Gaming" },
    { slug: "technology", name: "Technology" },
    { slug: "sports", name: "Sports" },
    { slug: "news", name: "News" },
    { slug: "comedy", name: "Comedy" },
    { slug: "movies", name: "Movies" },
    { slug: "education", name: "Education" },
  ],
  TrendingSection: () => <p>Trending row content</p>,
  CategorySection: ({ name }: { name: string }) => <p>{name} row content</p>,
}));

import Home from "@/app/page";

describe("Home page", () => {
  it("renders the search hero and a row per home category", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "What do you want to watch?", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Search videos" })).toBeInTheDocument();

    expect(screen.getByText("Trending row content")).toBeInTheDocument();
    for (const name of ["Music", "Gaming", "Technology"]) {
      expect(screen.getByText(`${name} row content`)).toBeInTheDocument();
    }

    const browse = screen.getByRole("navigation", { name: "Browse categories" });
    expect(within(browse).getAllByRole("link")).toHaveLength(8);
    expect(within(browse).getByRole("link", { name: "News" })).toHaveAttribute(
      "href",
      "/category/news",
    );
  });
});
