/**
 * Authored "database needs updating" state for `/watch/[videoId]`.
 *
 * Shown when a local read fails because the SQLite file predates the committed
 * migrations (for example an old v0.1.0 file without `video_progress` or
 * `video_notes`). Every string is written by hand: no SQLite message, table
 * name, stack or file path is passed in, so none of it can reach the HTML.
 *
 * Viewly deliberately does not run migrations from a request: that is a setup
 * step with an explicit command, and running it from a render would mutate the
 * database as a side effect of viewing a page.
 *
 * It renders inside the app shell's <main> landmark, so it must not render its
 * own <main>.
 */
export function WatchDatabaseState() {
  return (
    <div
      data-slot="watch-database-state"
      className="flex w-full items-center justify-center px-6 py-16"
    >
      <section
        aria-labelledby="watch-database-heading"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center sm:p-8"
      >
        <p className="text-sm font-medium text-primary">Local setup required</p>
        <h1
          id="watch-database-heading"
          className="mt-2 text-2xl font-semibold tracking-tight text-foreground"
        >
          Database needs updating
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This Viewly database is missing tables the current version expects. Run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
            npm run db:migrate
          </code>{" "}
          in the project root, then reload this page.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your saved videos, history and notes stay on this device; the update only adds the missing
          tables.
        </p>
      </section>
    </div>
  );
}
