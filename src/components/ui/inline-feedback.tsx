"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** How long a save confirmation stays on screen before it clears itself. */
export const INLINE_FEEDBACK_VISIBLE_MS = 4000;

export interface InlineFeedbackProps {
  /** Text to announce; `null` keeps the live region mounted but empty. */
  message: string | null;
  /**
   * Placement classes. Callers position the region absolutely (for example
   * `absolute top-full right-0 mt-1`) so showing a confirmation never reflows
   * the card or the action row.
   */
  className?: string;
}

/**
 * A short, non-blocking confirmation for a completed action.
 *
 * The `<p role="status">` stays mounted for the life of the control so assistive
 * technology has a live region to observe *before* the text changes; an empty
 * region announces nothing. `aria-live="polite"` queues the message behind
 * whatever the user is reading instead of interrupting it.
 *
 * The region is a plain inline element with no focusable content: it never
 * steals focus, never blocks a click (`pointer-events-none`) and, because the
 * caller places it absolutely, adding or clearing the message does not shift
 * the surrounding layout. `opacity-0` hides the empty region instead of
 * `display: none`, which would remove it from the accessibility tree.
 */
export function InlineFeedback({ message, className }: InlineFeedbackProps) {
  return (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-slot="inline-feedback"
      className={cn(
        "pointer-events-none rounded bg-background/95 px-1.5 py-0.5 text-xs break-words text-muted-foreground shadow-sm transition-opacity duration-150 ease-out motion-reduce:transition-none",
        message === null ? "opacity-0" : "opacity-100",
        className,
      )}
    >
      {message ?? ""}
    </p>
  );
}

/**
 * State for one short-lived confirmation message.
 *
 * `show` replaces any pending message and restarts the timer, so a rapid second
 * save does not clear the newest text early. `dismiss` clears immediately when
 * a new attempt starts. The timer is cleared on unmount so a component that
 * leaves the page mid-confirmation cannot leave a stray update behind.
 */
export function useTransientFeedback(timeoutMs: number = INLINE_FEEDBACK_VISIBLE_MS) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setMessage(null);
  }, []);

  const show = useCallback(
    (next: string) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }

      setMessage(next);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setMessage(null);
      }, timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { message, show, dismiss };
}
