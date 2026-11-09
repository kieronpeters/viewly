import Link from "next/link";

/**
 * Root 404 UI. Rendered for `notFound()` calls and unmatched routes inside the
 * app shell's <main> landmark, so this file must not render its own <main>.
 * Self-contained for the same reason as error.tsx: no dependency on UI-kit code.
 */
export default function NotFound() {
  return (
    <div className="flex w-full items-center justify-center bg-background px-6 py-16 text-foreground">
      <section
        aria-labelledby="not-found-heading"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center sm:p-8"
      >
        <p className="text-sm font-medium text-primary">404</p>
        <h1 id="not-found-heading" className="mt-2 text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The page you are looking for does not exist or has moved. Check the address, or head back
          home.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Go home
        </Link>
      </section>
    </div>
  );
}
