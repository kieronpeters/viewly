"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary (Next.js 16 error.js convention).
 *
 * Next forwards `error` as `unknown`: a server error arrives as an `Error` with a
 * generic message plus a `digest`, a client error arrives as whatever was
 * thrown. Nothing from the server is rendered beyond the digest; the thrown
 * value is never displayed, so stacks and server detail stay out of the DOM.
 *
 * The fallback is intentionally self-contained (no UI-kit imports) so it still
 * renders if a shared component is the thing that failed. It renders inside the
 * app shell's <main> landmark, so it must not add its own <main>.
 */
interface ErrorBoundaryProps {
  error: unknown;
  /** Next 16 passes both; `reset` clears the boundary state. */
  reset: () => void;
  /** Next 16's preferred recovery: re-fetch the segment, then re-render. */
  retry?: () => void;
}

/** Next attaches a hash of the server error; safe to show and useful for logs. */
function getErrorDigest(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const digest = (error as Record<string, unknown>).digest;
  return typeof digest === "string" && digest.length > 0 ? digest : null;
}

export default function ErrorBoundary({ error, reset, retry }: ErrorBoundaryProps) {
  const digest = getErrorDigest(error);

  useEffect(() => {
    // Name and digest only: no stack, no message, nothing that could carry data.
    console.error("[client-error]", {
      name: error instanceof Error ? error.name : typeof error,
      digest,
    });
  }, [error, digest]);

  function handleTryAgain(): void {
    // `retry` re-fetches before re-rendering; `reset` is the fallback.
    (retry ?? reset)();
  }

  return (
    <div className="flex w-full items-center justify-center bg-background px-6 py-16 text-foreground">
      <section
        aria-labelledby="error-heading"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 sm:p-8"
      >
        <p className="text-sm font-medium text-destructive">Error</p>
        <h1 id="error-heading" className="mt-2 text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          We hit an unexpected error while loading this page. Trying again often fixes it. If it
          keeps happening, go back home and start over.
        </p>

        {digest === null ? null : (
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Reference: <code className="font-mono text-foreground">{digest}</code>
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleTryAgain}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Go home
          </Link>
        </div>
      </section>
    </div>
  );
}
