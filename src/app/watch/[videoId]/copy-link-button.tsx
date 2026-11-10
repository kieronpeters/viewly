"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** How long the copied confirmation stays on the control. */
const COPIED_RESET_MS = 2500;

export interface CopyLinkButtonProps {
  /** Normalized 11-character YouTube id; never a raw route segment. */
  videoId: string;
  /** Optional layout classes; the caller owns positioning. */
  className?: string;
}

/**
 * Copy the current watch page URL to the clipboard (T77).
 *
 * The URL is built from the viewer's own origin at click time, so the copied
 * link points at this deployment rather than at production YouTube. Clipboard
 * access can be unavailable (older browsers, insecure origins, a denied
 * permission); that is reported inline instead of throwing, and the button
 * stays usable.
 *
 * The visible icon swaps to a check mark and the live region confirms the copy,
 * so the result does not depend on the icon colour alone. The control keeps the
 * same 44px target and focus ring as the save controls beside it.
 */
export function CopyLinkButton({ videoId, className }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function handleCopy() {
    setError(null);

    try {
      const url = `${window.location.origin}/watch/${encodeURIComponent(videoId)}`;

      await navigator.clipboard.writeText(url);

      setCopied(true);

      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
      }

      resetTimer.current = setTimeout(() => {
        setCopied(false);
        resetTimer.current = null;
      }, COPIED_RESET_MS);
    } catch {
      setCopied(false);
      setError("Could not copy the link.");
    }
  }

  return (
    <div data-slot="copy-link-button" className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        aria-label={copied ? "Link copied" : "Copy link"}
        onClick={handleCopy}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors outline-none",
          "hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          copied && "border-primary/40 bg-background text-primary hover:bg-surface",
        )}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-5" strokeWidth={2.25} />
        ) : (
          <Link2 aria-hidden="true" className="size-5" strokeWidth={2} />
        )}
      </button>

      <p role="status" className="sr-only">
        {copied ? "Link copied to clipboard." : ""}
      </p>

      {error === null ? null : (
        <p
          role="alert"
          className="max-w-44 rounded bg-background/95 px-1.5 py-0.5 text-right text-xs break-words text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
