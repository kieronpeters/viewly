"use client";

import { Search, X } from "lucide-react";
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
 * The primary search input, shaped like the observed masthead field.
 *
 * A client component because it trims the value, clears the field, and listens
 * for the `/` focus shortcut; it never performs a request on its own. Submitting
 * pushes `/search?q=...` through the router. The form keeps `action`/`method`
 * so it still works as a plain GET form before hydration.
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

  function clearQuery() {
    setQuery("");
    setError(null);
    inputRef.current?.focus();
  }

  /**
   * `/` focuses search, like the observed surface. Ignored while the user is
   * typing in a field or editing content, so it never steals a literal slash.
   */
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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
        <div className="relative min-w-0 flex-1">
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
            placeholder="Search"
            autoComplete="off"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            enterKeyHint="search"
            aria-invalid={error === null ? undefined : true}
            aria-describedby={error === null ? undefined : errorId}
            className="h-10 min-w-0 rounded-full border-border bg-surface pr-10 text-base focus-visible:border-ring"
          />
          {query === "" ? null : (
            <button
              type="button"
              onClick={clearQuery}
              aria-label="Clear search query"
              className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
        <Button
          type="submit"
          size="icon"
          disabled={isPending}
          aria-label="Search"
          className="size-10 shrink-0 rounded-full"
        >
          <Search aria-hidden="true" />
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
 * `useSearchParams` is a request-time hook, so the shell renders this inside a
 * `<Suspense>` boundary. The key remounts the field when the query changes, so
 * back/forward and a hard refresh restore the same value.
 */
export function SearchFormWithQuery() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";

  return <SearchForm key={query} initialQuery={query} />;
}
