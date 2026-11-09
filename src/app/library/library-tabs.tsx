import Link from "next/link";

import type { LibraryCounts } from "@/features/library";
import { cn } from "@/lib/utils";

/**
 * Tab definitions for `/library` (T37).
 *
 * These are links, not an ARIA `tablist`. Each tab is a distinct URL
 * (`/library?tab=history`), so the URL is the state: the page works without
 * JavaScript, a tab can be bookmarked or shared, the back button steps between
 * tabs, and the active tab is announced with `aria-current="page"` — the
 * correct signal for "link to the page you are on" (a `role="tab"` widget
 * would promise arrow-key handling and a `tabpanel` relationship the page does
 * not need). Keyboard support is the browser's: Tab reaches each link in order
 * and Enter follows it.
 *
 * The order is the order users scan the page in: saved, queued, watched, then
 * grouped. Favourites is first because it is the default tab.
 */
const TAB_DEFINITIONS = [
  { id: "favourites", label: "Favourites", countKey: "favourites" },
  { id: "watch-later", label: "Watch later", countKey: "watchLater" },
  { id: "history", label: "History", countKey: "history" },
  { id: "playlists", label: "Playlists", countKey: "playlists" },
] as const satisfies readonly {
  id: string;
  label: string;
  countKey: keyof LibraryCounts;
}[];

/** One of the four library sections. */
export type LibraryTab = (typeof TAB_DEFINITIONS)[number]["id"];

/**
 * Resolves `?tab=` to a known tab.
 *
 * Favourites is the default, so an absent, unknown, stale or duplicated value
 * (`?tab=music`, `?tab=favourites&tab=history`) all land on the favourites
 * list rather than an empty page. Repeated parameters use the first value, the
 * same rule `/category/[slug]` applies to `pageToken`.
 */
export function resolveLibraryTab(value: string | string[] | undefined): LibraryTab {
  const candidate = Array.isArray(value) ? value[0] : value;

  return TAB_DEFINITIONS.find((tab) => tab.id === candidate)?.id ?? "favourites";
}

/**
 * Canonical URL for a tab.
 *
 * Favourites is the default, so it keeps the bare `/library` URL instead of
 * duplicating itself as `/library?tab=favourites`.
 */
export function libraryTabHref(tab: LibraryTab): string {
  return tab === "favourites" ? "/library" : `/library?tab=${tab}`;
}

export interface LibraryTabsProps {
  /** Tab whose link carries `aria-current="page"`. */
  activeTab: LibraryTab;
  /** Totals from `countLibraryEntries`, shown as a badge on each tab. */
  counts: LibraryCounts;
}

/**
 * Accessible tab navigation for `/library`.
 *
 * The row wraps rather than scrolling: at 360px the four pills flow onto extra
 * lines, so nothing is clipped and no horizontal scroll container is needed.
 * Each pill is at least 44px tall (a touch target) and keeps its label on one
 * line, while the row itself is free to break between pills.
 */
export function LibraryTabs({ activeTab, counts }: LibraryTabsProps) {
  return (
    <nav aria-label="Library sections" className="min-w-0">
      <ul role="list" className="flex flex-wrap gap-2">
        {TAB_DEFINITIONS.map((tab) => {
          const isActive = tab.id === activeTab;
          const count = counts[tab.countKey];

          return (
            <li key={tab.id} className="min-w-0">
              <Link
                href={libraryTabHref(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3 text-sm font-medium outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
                )}
              >
                <span className="whitespace-nowrap">{tab.label}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs tabular-nums",
                    isActive
                      ? "bg-primary-foreground/15 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
                {/*
                 * The badge is decorative, so the count is repeated for screen
                 * readers as "(3)" to keep the link's name unambiguous.
                 */}
                <span className="sr-only"> ({count})</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
