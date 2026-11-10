"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import type { VideoNote } from "@/features/notes/notes";
import { cn } from "@/lib/utils";

import { WatchComments } from "./watch-comments";
import { WatchNotes } from "./watch-notes";

/**
 * Tab definitions for the comments/notes region (T77).
 *
 * T79 owns the notes panel and T80 owns the comments panel, so neither has to
 * restructure the tab widget. The panels stay in the same labelled regions the
 * layout was authored around.
 */
const TABS = [
  { id: "comments", label: "Comments" },
  { id: "notes", label: "Your notes" },
] as const;

type DiscussionTab = (typeof TABS)[number]["id"];

export interface WatchDiscussionTabsProps {
  /** The video whose comments are listed and whose notes are edited. */
  videoId: string;
  /** Notes read on the server for this render, newest first. */
  initialNotes: readonly VideoNote[];
}

/**
 * Comments and notes tabs below the description.
 *
 * A real ARIA tab widget: buttons carry `role="tab"`, the active one has
 * `aria-selected` and a roving `tabIndex`, and Left/Right/Home/End move between
 * tabs — the keyboard behaviour that a `tablist` promises. Both panels stay in
 * the DOM and are toggled with `hidden`, so every `aria-controls` reference
 * resolves and switching tabs never remounts panel state.
 *
 * The comments panel is a client component that fetches its own read-only page;
 * the notes panel is seeded with the server-read local notes and mutates them
 * through Server Actions. A comments failure is contained there and can never
 * break the player or the rest of the watch page.
 */
export function WatchDiscussionTabs({ videoId, initialNotes }: WatchDiscussionTabsProps) {
  const [activeTab, setActiveTab] = useState<DiscussionTab>("comments");
  const baseId = useId();
  const tabRefs = useRef<Record<DiscussionTab, HTMLButtonElement | null>>({
    comments: null,
    notes: null,
  });

  const tabId = (tab: DiscussionTab) => `${baseId}-tab-${tab}`;
  const panelId = (tab: DiscussionTab) => `${baseId}-panel-${tab}`;

  function activate(tab: DiscussionTab) {
    setActiveTab(tab);
    tabRefs.current[tab]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TABS.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    activate(TABS[nextIndex].id);
  }

  return (
    <section
      data-slot="watch-discussion"
      aria-label="Comments and notes"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div
        role="tablist"
        aria-label="Comments and notes"
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-full border border-border bg-background p-1"
      >
        {TABS.map((tab, index) => {
          const isActive = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={isActive}
              aria-controls={panelId(tab.id)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={panelId(tab.id)}
            aria-labelledby={tabId(tab.id)}
            tabIndex={0}
            hidden={!isActive}
            data-slot={`watch-${tab.id}-panel`}
            className="min-w-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
          >
            {tab.id === "comments" ? (
              <WatchComments videoId={videoId} />
            ) : (
              <WatchNotes videoId={videoId} initialNotes={initialNotes} />
            )}
          </div>
        );
      })}
    </section>
  );
}
