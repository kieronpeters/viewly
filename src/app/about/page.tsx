import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About · Viewly",
  description:
    "A local-first, single-user YouTube discovery app that keeps your library on this device.",
};

const linkClasses =
  "inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * `/about` — the destination behind the palette's About command.
 *
 * Static content only: no request data and no client component, so the page is
 * part of the prerendered shell.
 */
export default function AboutPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">About</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
          Viewly is a local-first way to find something to watch.
        </h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          Viewly is a single-user discovery app. It searches YouTube, keeps the videos you save in a
          library on this machine, and shows simple watch stats from your local history.
        </p>
      </header>

      <section aria-labelledby="about-local" className="flex flex-col gap-3">
        <h2 id="about-local" className="text-lg font-semibold tracking-tight text-foreground">
          Local-first by design
        </h2>
        <p className="text-pretty text-muted-foreground">
          There are no accounts, no cloud database and no telemetry. Favourites, watch later,
          history and playlists live in a SQLite file on this device. The only outbound service is
          YouTube: its Data API for search and video details, and its embed on the watch page.
        </p>
      </section>

      <section aria-labelledby="about-do" className="flex flex-col gap-3">
        <h2 id="about-do" className="text-lg font-semibold tracking-tight text-foreground">
          What you can do
        </h2>
        <ul className="grid gap-2 text-muted-foreground sm:grid-cols-2">
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            Browse trending videos and categories.
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            Search by topic, channel or title.
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            Save videos to favourites, watch later or a playlist.
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            Review watch time and activity in stats.
          </li>
        </ul>
      </section>

      <section aria-labelledby="about-shortcuts" className="flex flex-col gap-3">
        <h2 id="about-shortcuts" className="text-lg font-semibold tracking-tight text-foreground">
          Moving around
        </h2>
        <p className="text-pretty text-muted-foreground">
          Press <kbd className="font-mono text-sm text-foreground">Ctrl</kbd> or{" "}
          <kbd className="font-mono text-sm text-foreground">⌘</kbd> +{" "}
          <kbd className="font-mono text-sm text-foreground">K</kbd> anywhere to open the command
          palette. Search for a page or action, move with the arrow keys, and press Enter to go.
        </p>
      </section>

      <nav
        aria-label="Explore Viewly"
        className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4"
      >
        <Link href="/" className={linkClasses}>
          Home
        </Link>
        <Link href="/search" className={linkClasses}>
          Search
        </Link>
        <Link href="/library" className={linkClasses}>
          Library
        </Link>
        <Link href="/library/stats" className={linkClasses}>
          Watch stats
        </Link>
      </nav>
    </div>
  );
}
