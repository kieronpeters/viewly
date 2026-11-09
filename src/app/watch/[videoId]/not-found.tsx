import Link from "next/link";

/**
 * Segment-level 404 for `/watch/[videoId]`.
 *
 * Rendered by `notFound()` for a malformed id or a video YouTube does not
 * return. It sits inside the app shell's <main> landmark, so it must not render
 * its own <main>.
 */
export default function WatchNotFound() {
  return (
    <div className="flex w-full items-center justify-center px-6 py-16">
      <section
        aria-labelledby="watch-not-found-heading"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center sm:p-8"
      >
        <p className="text-sm font-medium text-primary">404</p>
        <h1
          id="watch-not-found-heading"
          className="mt-2 text-2xl font-semibold tracking-tight text-foreground"
        >
          Video not found
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This video does not exist, is private, or the link is malformed. Check the address or head
          back home.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Back to home
        </Link>
      </section>
    </div>
  );
}
