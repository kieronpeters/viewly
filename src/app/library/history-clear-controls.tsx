"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { clearAllHistory, clearHistoryEntry } from "@/features/library/history-actions";

/** Copy shown when a clear fails for a reason the UI cannot explain. */
const ERROR_MESSAGE = "Could not clear your watch history. Please try again.";

export interface HistoryClearEntryButtonProps {
  /** Video id of the row this control removes. */
  videoId: string;
  /** Video title, used in the accessible name and the confirmation copy. */
  title: string;
}

/**
 * Two-step "remove one video" control for the history tab.
 *
 * The first press only reveals the confirmation; nothing is sent until the
 * second press, which is the destructive action. This mirrors the playlist
 * delete control: an inline `role="group"` replaces the trigger, with a real
 * Cancel button, so no dialog library is needed and the control stays in the
 * normal tab order.
 *
 * The trigger carries the video title in its accessible name because the tab
 * can show many identical "Remove from history" buttons. A successful action
 * revalidates `/library`, so the row disappears on the server response and this
 * component unmounts; no local list copy is kept.
 */
export function HistoryClearEntryButton({ videoId, title }: HistoryClearEntryButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClear() {
    setError(null);

    startTransition(async () => {
      try {
        await clearHistoryEntry(videoId);
      } catch {
        setError(ERROR_MESSAGE);
      }
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          aria-label={`Remove ${title} from history`}
          onClick={() => setConfirming(true)}
        >
          Remove from history
        </Button>
        {error === null ? null : (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Confirm remove from history"
      className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
    >
      <p className="text-sm break-words text-foreground">
        Remove “{title}” from your watch history?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="min-h-11"
          disabled={isPending}
          onClick={handleClear}
        >
          Remove permanently
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={isPending}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export interface HistoryClearAllButtonProps {
  /** Number of recorded videos, used in the confirmation copy. */
  count: number;
}

/**
 * Two-step "clear everything" control for the history tab.
 *
 * Same inline confirmation pattern as the per-item control. The action empties
 * the table and revalidates `/library`, so the tab switches to its empty state
 * without a client-side list update.
 */
export function HistoryClearAllButton({ count }: HistoryClearAllButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClearAll() {
    setError(null);

    startTransition(async () => {
      try {
        await clearAllHistory();
      } catch {
        setError(ERROR_MESSAGE);
      }
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => setConfirming(true)}
        >
          Clear watch history
        </Button>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Confirm clear watch history"
      className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
    >
      <p className="text-sm text-foreground">
        Clear all {count} watched {count === 1 ? "video" : "videos"}? This cannot be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          className="min-h-11"
          disabled={isPending}
          onClick={handleClearAll}
        >
          Clear permanently
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={isPending}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
