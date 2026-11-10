"use client";

import { Headphones } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ListenModeToggleProps {
  /** Whether the compact audio-first layout is active. */
  enabled: boolean;
  /** Flips the preference; the parent persists it locally. */
  onToggle: () => void;
  /** Optional wrapper classes; spacing stays with the parent layout. */
  className?: string;
}

/**
 * The watch page's listen-mode switch (T86).
 *
 * A real `role="switch"` button, so it is reachable with Tab and flipped with
 * Enter or Space without any custom key handling. The visible track mirrors the
 * rail's autoplay switch, including `motion-reduce:transition-none`.
 */
export function ListenModeToggle({ enabled, onToggle, className }: ListenModeToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Listen mode"
      data-slot="listen-mode-toggle"
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-md px-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
        enabled && "text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors motion-reduce:transition-none",
          enabled ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-background transition-transform motion-reduce:transition-none",
            enabled ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      <Headphones aria-hidden="true" className="size-4" />
      Listen mode
    </button>
  );
}
