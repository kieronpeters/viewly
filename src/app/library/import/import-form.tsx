"use client";

import { useActionState } from "react";

import { importWatchHistory, type ImportResult } from "./actions";

const INITIAL: ImportResult | null = null;

/** Upload form for the owner's Takeout `watch-history.json`. */
export function ImportHistoryForm() {
  const [result, action, pending] = useActionState(importWatchHistory, INITIAL);

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-3">
      <label htmlFor="watch-history" className="text-sm font-medium">
        Takeout watch-history.json
      </label>
      <input
        id="watch-history"
        name="file"
        type="file"
        accept="application/json,.json"
        required
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import history"}
        </button>
        {result ? (
          <p
            role="status"
            className={result.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
          >
            {result.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
