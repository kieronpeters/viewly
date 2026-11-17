"use client";

import { MoreVertical } from "lucide-react";
import * as React from "react";

export interface VideoCardMenuProps {
  /** Normalized video id; used for the local route and the YouTube link. */
  videoId: string;
  /** Video title, for the menu's accessible label context. */
  title: string;
}

const ITEM_CLASSES =
  "flex w-full items-center rounded-lg px-3 py-2 text-sm text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Per-card overflow menu, shaped like the observed surface's "More actions".
 *
 * Escape closes the menu and returns focus to the trigger; a pointer outside
 * closes it too. Actions stay local-first: copy the viewly link, open the
 * official page on YouTube, or open the internal watch route.
 */
export function VideoCardMenu({ videoId, title }: VideoCardMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  async function copyLink() {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/watch/${videoId}`);
      setStatus("Link copied");
    } catch {
      setStatus("Could not copy the link");
    }
  }

  return (
    <div data-slot="video-card-menu" className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreVertical aria-hidden="true" className="size-4" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${title}`}
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          <button type="button" role="menuitem" onClick={copyLink} className={ITEM_CLASSES}>
            Copy link
          </button>
          <a
            role="menuitem"
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={ITEM_CLASSES}
          >
            Open on YouTube
          </a>
          <a role="menuitem" href={`/watch/${videoId}`} className={ITEM_CLASSES}>
            Open video page
          </a>
        </div>
      ) : null}

      <span role="status" className="sr-only">
        {status}
      </span>
    </div>
  );
}
