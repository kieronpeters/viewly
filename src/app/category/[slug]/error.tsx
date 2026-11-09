"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

interface CategoryErrorProps {
  /** Thrown value, forwarded as `unknown` by Next. Never rendered. */
  error: unknown;
  /** Next 16's preferred recovery: re-fetch the segment, then re-render. */
  retry?: () => void;
  /** Clears the boundary state without re-fetching; fallback for `retry`. */
  reset: () => void;
}

/**
 * Route-level error boundary for `/category/[slug]`.
 *
 * Expected failures (bad token, quota, network) are handled inside
 * `<CategoryPageContent>`; this file only catches unexpected rendering errors
 * that would otherwise take down the whole route. The bindings, the shape of
 * the page and the back link stay usable.
 */
export default function CategoryError({ error, retry, reset }: CategoryErrorProps) {
  useEffect(() => {
    // Name only: no stack, no message, nothing that could carry request data.
    console.error("[category-error]", error instanceof Error ? error.name : typeof error);
  }, [error]);

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-6 py-16">
      <ErrorState
        title="Could not load this category"
        message="Something went wrong while loading these videos. Please try again."
        onRetry={retry ?? reset}
      />
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}
