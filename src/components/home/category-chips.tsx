import Link from "next/link";

/** The subset of a category the chip nav needs. */
export interface CategoryChip {
  slug: string;
  name: string;
}

export interface CategoryChipsProps {
  /** Every shared category, in display order; already resolved server-side. */
  categories: readonly CategoryChip[];
}

/**
 * The chip row under the masthead: a single horizontally scrolling line of
 * category chips, shaped like the observed filter bar. Links go to each
 * category route; the row scrolls itself when it overflows on narrow screens.
 */
export function CategoryChips({ categories }: CategoryChipsProps) {
  return (
    <nav
      aria-labelledby="home-browse-heading"
      className="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1"
    >
      <h2 id="home-browse-heading" className="sr-only">
        Browse categories
      </h2>
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={`/category/${category.slug}`}
          className="inline-flex h-8 shrink-0 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {category.name}
        </Link>
      ))}
    </nav>
  );
}
