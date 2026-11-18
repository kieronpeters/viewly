import Link from "next/link";

import { DEFAULT_SEARCH_FILTERS, type SearchFilters } from "@/shared/search-filters";

import { buildSearchHref } from "./search-url";

export interface SearchChipsProps {
  /** Current query, carried into every chip link. */
  query: string;
  /** Active filters, used to mark the matching chip. */
  filters: SearchFilters;
}

function sameFilters(a: SearchFilters, b: SearchFilters): boolean {
  return a.duration === b.duration && a.order === b.order && a.uploadDate === b.uploadDate;
}

/**
 * The quick-filter chip row above the results.
 *
 * Links, not tabs: each chip is a `/search` URL that applies one filter, which
 * keeps the page server-rendered and the URL authoritative. The observed
 * surface uses a tablist with an in-place refilter; that difference is recorded
 * as a gap in the search parity report.
 */
export function SearchChips({ query, filters }: SearchChipsProps) {
  const chips: { label: string; filters: SearchFilters }[] = [
    { label: "All", filters: DEFAULT_SEARCH_FILTERS },
    { label: "Today", filters: { ...DEFAULT_SEARCH_FILTERS, uploadDate: "day" } },
    { label: "This week", filters: { ...DEFAULT_SEARCH_FILTERS, uploadDate: "week" } },
    { label: "This month", filters: { ...DEFAULT_SEARCH_FILTERS, uploadDate: "month" } },
    { label: "Long", filters: { ...DEFAULT_SEARCH_FILTERS, duration: "long" } },
    { label: "Short", filters: { ...DEFAULT_SEARCH_FILTERS, duration: "short" } },
  ];

  return (
    <div
      role="tablist"
      aria-label="Quick filters"
      className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1"
    >
      {chips.map((chip) => {
        const isActive = sameFilters(chip.filters, filters);

        return (
          <Link
            key={chip.label}
            href={buildSearchHref(query, null, chip.filters)}
            role="tab"
            aria-selected={isActive}
            className="inline-flex h-8 shrink-0 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-[selected=true]:bg-foreground aria-[selected=true]:text-background"
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
