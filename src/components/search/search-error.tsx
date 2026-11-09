"use client";

import { useRouter } from "next/navigation";

import { ErrorState } from "@/components/ui/error-state";

export interface SearchErrorProps {
  /** Plain-language explanation; never an upstream payload or URL. */
  message: string;
}

/**
 * Failure state for the results region.
 *
 * `ErrorState` needs a retry callback, which means a client component. Retrying
 * refreshes the current route, so the server component re-runs the same search
 * with the same `q` and page token. The surrounding page (heading, form) stays
 * interactive, so a failed search never takes down the whole route.
 */
export function SearchError({ message }: SearchErrorProps) {
  const router = useRouter();

  return <ErrorState title="Search failed" message={message} onRetry={() => router.refresh()} />;
}
