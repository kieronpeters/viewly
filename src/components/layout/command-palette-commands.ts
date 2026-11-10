import {
  ChartColumn,
  Clock,
  Heart,
  House,
  Info,
  Library,
  Link2,
  ListVideo,
  RotateCcwClock,
  Search,
  type LucideIcon,
} from "lucide-react";

import { buildSearchHref } from "@/components/search/search-url";

/** The group label shown on the right of a palette row. */
export type CommandGroup = "Go to" | "Library" | "Actions" | "Search";

/**
 * One entry in the command palette.
 *
 * A command either navigates (`href`) or runs a safe in-page action (`action`).
 * Destructive operations are deliberately absent: the palette is a shortcut for
 * moving around and copying the current link, not a place to delete anything.
 */
export interface PaletteCommand {
  id: string;
  title: string;
  group: CommandGroup;
  /** Extra words the fuzzy matcher may use; never displayed. */
  keywords: readonly string[];
  href?: string;
  action?: "copy-current-page-link";
  icon: LucideIcon;
}

/**
 * Static destinations. Order is the order shown when the query is empty:
 * the three shell destinations first, then the library tabs, stats and About.
 *
 * Library tab hrefs mirror `libraryTabHref()` in
 * `src/app/library/library-tabs.tsx`; they are repeated here rather than
 * imported so the global palette does not depend on a page-level module.
 */
const BASE_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "home",
    title: "Home",
    group: "Go to",
    keywords: ["home", "discover", "start", "trending", "popular"],
    href: "/",
    icon: House,
  },
  {
    id: "search",
    title: "Search",
    group: "Go to",
    keywords: ["search", "find", "videos", "query"],
    href: "/search",
    icon: Search,
  },
  {
    id: "library",
    title: "Library",
    group: "Go to",
    keywords: ["library", "saved", "collection"],
    href: "/library",
    icon: Library,
  },
  {
    id: "library-favourites",
    title: "Favourites",
    group: "Library",
    keywords: ["favourites", "favorites", "saved", "liked", "library"],
    href: "/library",
    icon: Heart,
  },
  {
    id: "library-watch-later",
    title: "Watch later",
    group: "Library",
    keywords: ["watch later", "queue", "later", "saved", "library"],
    href: "/library?tab=watch-later",
    icon: Clock,
  },
  {
    id: "library-history",
    title: "History",
    group: "Library",
    keywords: ["history", "watched", "recent", "library"],
    href: "/library?tab=history",
    icon: RotateCcwClock,
  },
  {
    id: "library-playlists",
    title: "Playlists",
    group: "Library",
    keywords: ["playlists", "lists", "collections", "library"],
    href: "/library?tab=playlists",
    icon: ListVideo,
  },
  {
    id: "stats",
    title: "Stats",
    group: "Go to",
    keywords: ["stats", "statistics", "watch time", "history", "heatmap", "activity"],
    href: "/library/stats",
    icon: ChartColumn,
  },
  {
    id: "about",
    title: "About",
    group: "Go to",
    keywords: ["about", "viewly", "info", "privacy", "local"],
    href: "/about",
    icon: Info,
  },
  {
    id: "copy-current-page-link",
    title: "Copy current page link",
    group: "Actions",
    keywords: ["copy", "link", "url", "share", "clipboard", "current page"],
    action: "copy-current-page-link",
    icon: Link2,
  },
];

/**
 * Score given to the synthetic "Search for …" row. Clear title and keyword
 * matches outrank it; weak subsequence-only matches fall behind it.
 */
const SEARCH_QUERY_SCORE = 500;

/**
 * Normalises case, accents, punctuation and repeated spaces so `watch-later`,
 * `Watch later` and `watch_later` all match the same command.
 */
function normalise(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * Scores one field against one query token.
 *
 * Exact and prefix matches rank above a substring, which ranks above a
 * subsequence. `null` means the token does not occur at all.
 */
function scoreField(value: string, token: string): number | null {
  const target = normalise(value);

  if (target === token) {
    return 1200;
  }

  if (target.startsWith(token)) {
    return 1000 - Math.min(target.length, 80);
  }

  const index = target.indexOf(token);

  if (index !== -1) {
    return 800 - Math.min(index * 4 + target.length, 120);
  }

  // Fuzzy fallback: every character must appear in order. Gaps and a longer
  // target lower the score, so "hm" prefers Home over Watch later. A match
  // anchored at the start of the word is stronger than one starting mid-word,
  // which keeps abbreviations like "hm" ahead of the synthetic search row
  // while arbitrary text ("cats") still falls back to search.
  let cursor = 0;
  let gaps = 0;
  let previousIndex = -1;
  let firstIndex = -1;

  for (const character of token) {
    const found = target.indexOf(character, cursor);

    if (found === -1) {
      return null;
    }

    if (previousIndex === -1) {
      firstIndex = found;
    } else {
      gaps += found - previousIndex - 1;
    }

    previousIndex = found;
    cursor = found + 1;
  }

  const baseScore = 400 - Math.min(gaps * 8 + (target.length - token.length), 250);

  return firstIndex === 0 ? baseScore + 150 : baseScore;
}

/** Every token must match the title or one of the keywords. */
function scoreCommand(command: PaletteCommand, tokens: readonly string[]): number | null {
  let total = 0;

  for (const token of tokens) {
    const titleScore = scoreField(command.title, token);
    let keywordScore: number | null = null;

    for (const keyword of command.keywords) {
      const score = scoreField(keyword, token);

      if (score !== null && (keywordScore === null || score > keywordScore)) {
        keywordScore = score;
      }
    }

    if (titleScore === null && keywordScore === null) {
      return null;
    }

    // A keyword hit is useful but should not beat the command's own title.
    total += Math.max(titleScore ?? 0, keywordScore === null ? 0 : keywordScore * 0.75);
  }

  return total;
}

/**
 * Builds the visible command list for a query.
 *
 * With text in the field, the existing Search destination follows that text
 * (`/search?q=…`) unless the text is exactly "search". If no command matches the
 * text, a synthetic "Search for …" row is appended with a fixed score so
 * arbitrary queries still have an action; a clear title or keyword match still
 * sorts above it. The returned list is new on every call, so callers can safely
 * pass it to a memoised selector.
 */
export function getPaletteCommands(query: string): PaletteCommand[] {
  const normalisedQuery = normalise(query);
  const tokens = normalisedQuery === "" ? [] : normalisedQuery.split(" ");

  const scored = BASE_COMMANDS.flatMap((command, order) => {
    const score = tokens.length === 0 ? 0 : scoreCommand(command, tokens);

    return score === null ? [] : [{ command, order, score }];
  });

  const trimmedQuery = query.trim();
  const searchPageMatched = scored.some((entry) => entry.command.id === "search");

  if (trimmedQuery !== "" && !searchPageMatched) {
    scored.push({
      command: {
        id: "search-query",
        title: `Search for “${trimmedQuery}”`,
        group: "Search",
        keywords: [trimmedQuery, "search", "find", "query"],
        href: buildSearchHref(trimmedQuery),
        icon: Search,
      },
      order: BASE_COMMANDS.length,
      score: SEARCH_QUERY_SCORE,
    });
  }

  scored.sort((left, right) => right.score - left.score || left.order - right.order);

  return scored.map((entry) => {
    const command = entry.command;

    // The Search row is the query-aware shortcut: typing "sea" and pressing
    // Enter searches for "sea" instead of dropping the text at an empty page.
    if (command.id === "search" && trimmedQuery !== "" && normalisedQuery !== "search") {
      return { ...command, href: buildSearchHref(trimmedQuery) };
    }

    return command;
  });
}
