"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_SEARCH_QUERY_LENGTH } from "@/shared/validation";

import { buildSearchHref } from "./search-url";

const INPUT_ID = "search-query";

export interface SearchFormProps {
  /** Current `?q=` value, used to prefill the input on a results page. */
  initialQuery?: string;
  className?: string;
}

/**
 * The primary search input.
 *
 * A client component only because it trims the value before navigating; it
 * never performs a request on its own, so typing costs nothing. Submitting
 * pushes `/search?q=...` through the router, and the page's server component
 * fetches the results. The form also keeps `action`/`method` so it still works
 * as a plain GET form before hydration.
 */
export function SearchForm({ initialQuery = "", className }: SearchFormProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState(initialQuery);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const errorId = React.useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = query.trim();
    if (trimmed === "") {
      // Nothing to search for: announce why and keep focus in the field instead
      // of navigating, so the silent no-op is not mistaken for a broken form.
      setError("Enter a search term to search.");
      inputRef.current?.focus();
      return;
    }

    setError(null);
    const href = buildSearchHref(trimmed);
    startTransition(() => router.push(href));
  }

  return (
    <form
      role="search"
      aria-label="Search videos"
      action="/search"
      method="get"
      onSubmit={handleSubmit}
      className={className}
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        <label htmlFor={INPUT_ID} className="sr-only">
          Search videos
        </label>
        <Input
          ref={inputRef}
          id={INPUT_ID}
          name="q"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (error !== null) {
              setError(null);
            }
          }}
          placeholder="Search videos"
          autoComplete="off"
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          enterKeyHint="search"
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
          className="h-11 min-w-0 flex-1 text-base"
        />
        <Button type="submit" size="lg" disabled={isPending} className="h-11 shrink-0 px-4">
          <Search aria-hidden="true" />
          <span>Search</span>
        </Button>
      </div>

      {error === null ? null : (
        <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * The form pre-filled from the URL.
 *
 * `useSearchParams` is a request-time hook, so the page renders this inside a
 * `<Suspense>` boundary. The boundary's fallback is the same empty form, which
 * keeps the input on screen (and usable) while the params resolve.
 */
export function SearchFormWithQuery() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";

  return <SearchForm key={query} initialQuery={query} />;
}
