"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { WATCH_SHORTCUT_HINTS } from "./watch-shortcuts";

export interface WatchShortcutsOverlayProps {
  /** Whether the panel is visible. Closing restores focus to the opener. */
  open: boolean;
  /** Called by the close button, `Escape` or a second `?` press. */
  onClose: () => void;
}

/** Selector for elements the Tab trap may move focus to. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard-shortcut panel for the watch player.
 *
 * It is a real dialog rather than a tooltip: `role="dialog"`, `aria-modal`,
 * a labelled title, and a Tab trap that keeps focus inside the panel. Opening
 * stores `document.activeElement`; closing (or unmounting) returns focus there,
 * so dismissing with `Escape` leaves the keyboard user where they started.
 *
 * The global key listener in `use-watch-shortcuts.ts` handles `Escape` when
 * focus is outside the panel; the handler below covers the normal case with
 * focus inside and stops propagation so the same press is not handled twice.
 * `?` is handled globally in both cases.
 */
export function WatchShortcutsOverlay({ open, onClose }: WatchShortcutsOverlayProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Capture the opener and move focus into the panel while it is open; restore
  // it on close. The cleanup also runs on unmount, which covers a route change.
  useEffect(() => {
    if (!open) {
      return;
    }

    const active = document.activeElement;

    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    panelRef.current?.focus();

    return () => {
      const target = returnFocusRef.current;

      returnFocusRef.current = null;

      if (target?.isConnected === true) {
        target.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;

    if (panel === null) {
      return;
    }

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      // Shift+Tab from the panel itself or its first control wraps to the end.
      if (active === first || active === panel) {
        event.preventDefault();
        last.focus();
      }

      return;
    }

    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      data-slot="watch-shortcuts-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              Keyboard shortcuts
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              Player shortcuts work anywhere on the page except while you are typing.
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <ul className="mt-4 divide-y divide-border">
          {WATCH_SHORTCUT_HINTS.map((hint) => (
            <li
              key={hint.description}
              className="flex items-center justify-between gap-4 py-2 text-sm"
            >
              <span className="flex flex-wrap items-center gap-1">
                {hint.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex min-w-7 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
              <span className="text-right text-muted-foreground">{hint.description}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs text-muted-foreground">
          Press <kbd className="font-mono">?</kbd> at any time to reopen this panel.
        </p>
      </div>
    </div>
  );
}
