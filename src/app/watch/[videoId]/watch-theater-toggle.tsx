"use client";

import { Theater } from "lucide-react";

import { cn } from "@/lib/utils";

export interface WatchTheaterToggleProps {
  /** Whether theater mode is on. */
  enabled: boolean;
  /** Flips theater mode; the provider persists the preference locally. */
  onToggle: () => void;
  /** Optional wrapper classes; spacing stays with the parent layout. */
  className?: string;
}

/**
 * The watch page's theater-mode switch (T70).
 *
 * A real toggle button (`aria-pressed`), so it is reachable with Tab, activated
 * with Enter or Space, and its state is announced without extra instructions.
 * The visible label is the accessible name; the target is at least 44×44 px and
 * the focus ring is shared with the other watch controls. Colour transitions
 * are suppressed under reduced motion.
 */
export function WatchTheaterToggle({ enabled, onToggle, className }: WatchTheaterToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      data-slot="watch-theater-toggle"
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
        enabled && "bg-accent text-accent-foreground hover:text-accent-foreground",
        className,
      )}
    >
      <Theater aria-hidden="true" className="size-4" />
      Theater
    </button>
  );
}
