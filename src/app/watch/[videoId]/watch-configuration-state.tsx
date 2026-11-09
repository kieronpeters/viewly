import Link from "next/link";

/**
 * Authored "YouTube is not configured" state for `/watch/[videoId]`.
 *
 * Shown instead of the player when the server has no usable YouTube API key.
 * Every string here is written by hand: no error message, stack, file path or
 * key value is passed in, so none of them can reach the HTML. The component
 * takes no props on purpose — there is nothing from the failure to interpolate.
 *
 * It renders inside the app shell's <main> landmark, so it must not render its
 * own <main>.
 */
export function WatchConfigurationState() {
  return (
    <div
      data-slot="watch-configuration-state"
      className="flex w-full items-center justify-center px-6 py-16"
    >
      <section
        aria-labelledby="watch-configuration-heading"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center sm:p-8"
      >
        <p className="text-sm font-medium text-primary">Setup required</p>
        <h1
          id="watch-configuration-heading"
          className="mt-2 text-2xl font-semibold tracking-tight text-foreground"
        >
          YouTube is not configured
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Viewly needs a YouTube Data API key before it can load videos. Add{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
            YOUTUBE_API_KEY
          </code>{" "}
          to{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
            .env.local
          </code>{" "}
          in the project root, then restart the app.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The key stays on the server and is never sent to the browser. Once it is set, this page
          loads normally.
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
