"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { cn } from "@/lib/utils";
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchDuration,
  type SearchFilters,
  type SearchOrder,
  type SearchUploadDate,
  nonDefaultSearchFilters,
  resolveSearchFilters,
} from "@/shared/search-filters";

import { buildSearchHref } from "./search-url";

const DURATION_OPTIONS: readonly { value: SearchDuration; label: string }[] = [
  { value: "any", label: "Any duration" },
  { value: "short", label: "Short (under 4 minutes)" },
  { value: "medium", label: "Medium (4–20 minutes)" },
  { value: "long", label: "Long (over 20 minutes)" },
];

const ORDER_OPTIONS: readonly { value: SearchOrder; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "date", label: "Upload date" },
  { value: "viewCount", label: "View count" },
];

const UPLOAD_DATE_OPTIONS: readonly { value: SearchUploadDate; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
];

/** Shared classes for the three native selects; they match the search input tokens. */
const SELECT_CLASSES =
  "h-11 min-w-0 rounded-md border border-input bg-surface px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

/** Stable comparison for the URL-derived filter state. */
function filtersSignature(filters: SearchFilters): string {
  return `${filters.duration}|${filters.order}|${filters.uploadDate}`;
}

export interface SearchFiltersProps {
  /** Current `?q=`, carried into every filter URL. */
  query: string;
  /** Current `?pageToken=`, preserved when a filter changes. */
  pageToken?: string | null;
  /** Active filters, already validated by the caller. */
  filters: SearchFilters;
  className?: string;
}

/**
 * Duration, upload-date and sort-order controls for `/search` (T88).
 *
 * The URL is the single source of truth: each control renders the value from
 * `filters`, and changing one pushes a new `/search` href that keeps `q` and
 * `pageToken`. A refresh or a back/forward step therefore restores exactly the
 * controls the URL describes; no filter state is held outside the URL.
 *
 * The controls also form a plain GET form (`action="/search"` with hidden `q`
 * and `pageToken`), so they still apply the selection before hydration. The
 * Apply button is the no-JavaScript path; with JavaScript the change handler
 * navigates immediately, and submitting is idempotent.
 */
export function SearchFilters({ query, pageToken = null, filters, className }: SearchFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  // Local state applies a selection immediately; the prop-signature check below
  // resets it whenever the URL-derived `filters` prop changes (a navigation, a
  // refresh or a back/forward step), so the URL stays authoritative.
  const incomingSignature = filtersSignature(filters);
  const [state, setState] = React.useState({ propsSignature: incomingSignature, filters });
  if (state.propsSignature !== incomingSignature) {
    setState({ propsSignature: incomingSignature, filters });
  }
  const currentFilters = state.filters;

  const fieldId = React.useId();
  const hasActiveFilters = Object.keys(nonDefaultSearchFilters(currentFilters)).length > 0;

  function navigate(next: SearchFilters) {
    startTransition(() => router.push(buildSearchHref(query, pageToken, next)));
  }

  function handleChange(name: keyof SearchFilters, value: string) {
    // Re-validate through the shared resolver: the select only ever offers valid
    // values, but this keeps the component from inventing a cast-only contract.
    const next = resolveSearchFilters({ ...currentFilters, [name]: value });
    setState((previous) => ({ ...previous, filters: next }));
    navigate(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = resolveSearchFilters({
      duration: data.get("duration"),
      order: data.get("order"),
      uploadDate: data.get("uploadDate"),
    });
    setState((previous) => ({ ...previous, filters: next }));
    navigate(next);
  }

  return (
    <form
      action="/search"
      method="get"
      aria-label="Search filters"
      onSubmit={handleSubmit}
      aria-busy={isPending || undefined}
      className={cn("flex flex-wrap items-end gap-3", className)}
    >
      <input type="hidden" name="q" value={query} />
      {pageToken === null || pageToken === "" ? null : (
        <input type="hidden" name="pageToken" value={pageToken} />
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <label
          htmlFor={`${fieldId}-duration`}
          className="text-xs font-medium text-muted-foreground"
        >
          Duration
        </label>
        <select
          id={`${fieldId}-duration`}
          name="duration"
          value={currentFilters.duration}
          onChange={(event) => handleChange("duration", event.target.value)}
          className={SELECT_CLASSES}
        >
          {DURATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <label
          htmlFor={`${fieldId}-uploadDate`}
          className="text-xs font-medium text-muted-foreground"
        >
          Upload date
        </label>
        <select
          id={`${fieldId}-uploadDate`}
          name="uploadDate"
          value={currentFilters.uploadDate}
          onChange={(event) => handleChange("uploadDate", event.target.value)}
          className={SELECT_CLASSES}
        >
          {UPLOAD_DATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${fieldId}-order`} className="text-xs font-medium text-muted-foreground">
          Sort by
        </label>
        <select
          id={`${fieldId}-order`}
          name="order"
          value={currentFilters.order}
          onChange={(event) => handleChange("order", event.target.value)}
          className={SELECT_CLASSES}
        >
          {ORDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
      >
        Apply filters
      </button>

      {hasActiveFilters ? (
        <Link
          href={buildSearchHref(query, pageToken)}
          prefetch={false}
          className="inline-flex h-11 items-center rounded-sm px-1 text-sm font-medium text-muted-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Clear filters
        </Link>
      ) : null}
    </form>
  );
}

/**
 * The filter row pre-filled from the URL.
 *
 * `useSearchParams` is a request-time hook, so the page renders this inside a
 * `<Suspense>` boundary. The `key` remounts the controls when the URL changes,
 * which is what makes back/forward and a hard refresh restore the selects
 * without any duplicated client-side state.
 */
export function SearchFiltersWithQuery() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const pageToken = searchParams.get("pageToken");

  let filters: SearchFilters = { ...DEFAULT_SEARCH_FILTERS };
  try {
    filters = resolveSearchFilters({
      duration: searchParams.get("duration"),
      order: searchParams.get("order"),
      uploadDate: searchParams.get("uploadDate"),
    });
  } catch {
    // The results panel explains an invalid filter value; the controls fall
    // back to defaults so the page still offers a way out.
  }

  return (
    <SearchFilters
      key={searchParams.toString()}
      query={query}
      pageToken={pageToken}
      filters={filters}
    />
  );
}
