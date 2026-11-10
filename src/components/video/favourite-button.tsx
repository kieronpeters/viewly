"use client";

import { Heart } from "lucide-react";
import { useState, useTransition } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { InlineFeedback, useTransientFeedback } from "@/components/ui/inline-feedback";
import { toggleFavourite } from "@/features/library/actions";
import type { FavouriteSnapshot } from "@/features/library/favourite-toggle";
import { cn } from "@/lib/utils";

/** Copy shown when the optimistic update is rolled back. */
const ERROR_MESSAGE = "Could not update favourites. Please try again.";
/** Brief confirmations shown in the inline status region after a toggle. */
const SAVED_MESSAGE = "Added to favourites.";
const REMOVED_MESSAGE = "Removed from favourites.";

export interface FavouriteButtonProps {
  /** Snapshot of the video being saved; already normalized by the caller. */
  video: FavouriteSnapshot;
  /** Saved state read on the server for this render. */
  initialFavourite: boolean;
  /** Optional layout classes; the caller owns positioning (e.g. the card overlay). */
  className?: string;
}

/**
 * Toggle between "saved" and "not saved" for one video.
 *
 * The control is optimistic: pressing it flips `aria-pressed` and the label
 * immediately, then awaits the Server Action. The action's return value wins on
 * success (so a double toggle cannot leave the client out of sync with SQLite);
 * on failure the previous state is restored and a short inline error is shown.
 *
 * The button is a real `<button type="button">` rather than a link, so it can be
 * placed next to the card link without nesting interactive elements. The 44px
 * square (`min-h-11 min-w-11`) keeps it on the touch-target baseline used by the
 * rest of the shell, and the visible focus ring matches the card link.
 *
 * `useState(initialFavourite)` intentionally ignores later prop changes: after
 * this component's action revalidates the route, a server re-render may deliver
 * the same value again, and resetting on every render would fight the optimistic
 * update. The action result is the only source of truth applied after mount.
 *
 * A successful toggle also announces a short confirmation in a polite inline
 * status region. The region is absolutely positioned below the control, so it
 * never reflows the card grid, and it clears itself after a few seconds.
 */
export function FavouriteButton({ video, initialFavourite, className }: FavouriteButtonProps) {
  const [favourited, setFavourited] = useState(initialFavourite);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedback = useTransientFeedback();

  function handleToggle() {
    const next = !favourited;

    setFavourited(next);
    setError(null);
    feedback.dismiss();

    startTransition(async () => {
      try {
        const result = await toggleFavourite(video);
        setFavourited(result.favourited);
        feedback.show(result.favourited ? SAVED_MESSAGE : REMOVED_MESSAGE);
      } catch {
        // Reconcile with what is still stored: undo the optimistic flip.
        setFavourited(!next);
        setError(ERROR_MESSAGE);
      }
    });
  }

  return (
    <div
      data-slot="favourite-button"
      className={cn("relative flex flex-col items-end gap-1", className)}
    >
      <button
        type="button"
        aria-pressed={favourited}
        aria-label={favourited ? "Remove from favourites" : "Add to favourites"}
        aria-busy={isPending}
        disabled={isPending}
        onClick={handleToggle}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none",
          "hover:bg-background hover:text-foreground hover:shadow-md hover:shadow-background/50 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
          FOCUS_RING,
          "disabled:opacity-60",
          // Saved state: an opaque canvas fill keeps the violet icon readable
          // over any thumbnail. A translucent `bg-primary/10` let the image
          // through and measured as low as 1.7:1 on a mid-tone thumbnail.
          favourited && "border-primary/40 bg-background text-primary hover:bg-surface",
        )}
      >
        <Heart
          aria-hidden="true"
          className={cn("size-5", favourited && "fill-current")}
          strokeWidth={favourited ? 2.25 : 2}
        />
      </button>

      <InlineFeedback
        message={feedback.message}
        className="absolute top-full right-0 z-10 mt-1 w-max max-w-44 text-right"
      />

      {error === null ? null : (
        <p
          role="alert"
          className="max-w-44 rounded bg-background/95 px-1.5 py-0.5 text-right text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
