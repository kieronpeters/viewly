"use client";

import { Fragment, useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { splitDescriptionLinks } from "./description-links";

/** Default rough character budget of one rendered line in the 20rem sidebar. */
const APPROXIMATE_CHARACTERS_PER_LINE = 44;

/** Lines visible before the description is clipped. Matches `max-h-40`. */
const COLLAPSED_MAX_LINES = 6;

/**
 * Whether a description is long enough to need a "Show more" control.
 *
 * This is a deterministic estimate rather than a DOM measurement so the server
 * and the client agree on the initial markup: a hydrating button whose
 * visibility depended on `scrollHeight` would flash or shift. A description
 * that renders within the collapsed height never gets a pointless control.
 */
export function shouldCollapseDescription(
  text: string,
  charactersPerLine: number = APPROXIMATE_CHARACTERS_PER_LINE,
): boolean {
  const estimatedLines = text.split(/\r\n|\r|\n/).reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / charactersPerLine));
  }, 0);

  return estimatedLines > COLLAPSED_MAX_LINES;
}

export interface ExpandableDescriptionProps {
  /** Plain-text description, rendered as text; line breaks are preserved. */
  text: string;
  /**
   * Rough characters that fit on one rendered line. The component cannot
   * measure the DOM during server rendering, so the caller supplies the width
   * of its own column: the 20rem sidebar uses the default, while the wide watch
   * column passes a larger value so it does not show "Show more" for text that
   * already fits.
   */
  charactersPerLine?: number;
  className?: string;
}

/**
 * Plain-text description with a client-side expand/collapse control.
 *
 * This is the only interactive piece of the details panel; everything else is a
 * server component. The text is rendered through React text nodes, never
 * through `dangerouslySetInnerHTML`, and only absolute `http`/`https` URLs are
 * turned into links (see `description-links.ts`).
 */
export function ExpandableDescription({
  text,
  charactersPerLine,
  className,
}: ExpandableDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const segments = useMemo(() => splitDescriptionLinks(text), [text]);

  const collapsible = shouldCollapseDescription(text, charactersPerLine);
  const collapsed = collapsible && !expanded;

  return (
    <div
      data-slot="expandable-description"
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      <div id={contentId} className={cn("min-w-0", collapsed && "max-h-40 overflow-hidden")}>
        <p
          data-slot="video-description"
          className="text-sm leading-relaxed break-words whitespace-pre-line text-muted-foreground"
        >
          {segments.map((segment, index) =>
            segment.type === "link" ? (
              <a
                key={`link-${index}`}
                href={segment.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="rounded-sm break-words text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {segment.text}
              </a>
            ) : (
              <Fragment key={`text-${index}`}>{segment.text}</Fragment>
            ),
          )}
        </p>
      </div>

      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex min-h-11 w-fit items-center rounded-md text-sm font-medium text-foreground underline-offset-4 outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
