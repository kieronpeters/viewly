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
 * Compact "Browse categories" nav shown under the hero.
 *
 * Links every category from the shared list to `/category/<slug>`, including
 * the ones without a discovery row of their own. Purely presentational: the
 * caller supplies the list, so this never fetches or costs YouTube quota.
 */
export function CategoryChips({ categories }: CategoryChipsProps) {
  return (
    <nav aria-labelledby="home-browse-heading" className="flex flex-col gap-2">
      <h2
        id="home-browse-heading"
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        Browse categories
      </h2>
      <ul className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={`/category/${category.slug}`}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
