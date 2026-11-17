"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface ChannelTabsProps {
  /** The uploads grid, already server-rendered. */
  videos: React.ReactNode;
  /** The long description, already server-rendered. */
  about: React.ReactNode;
}

const TABS = [
  { id: "videos", label: "Videos" },
  { id: "about", label: "About" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Channel section tabs, shaped like the observed tab bar.
 *
 * Viewly exposes two sections rather than the observed six (short-form, live,
 * playlists and posts have no data of their own), so the tablist renders only
 * what exists. Arrow keys, Home and End move focus; only the selected tab is in
 * the tab order, and each tab controls its panel.
 */
export function ChannelTabs({ videos, about }: ChannelTabsProps) {
  const [active, setActive] = React.useState<TabId>("videos");
  const tabRefs = React.useRef<Record<TabId, HTMLButtonElement | null>>({
    videos: null,
    about: null,
  });

  function moveFocus(nextIndex: number) {
    const next = TABS[(nextIndex + TABS.length) % TABS.length];
    setActive(next.id);
    tabRefs.current[next.id]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(TABS.length - 1);
    }
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div
        role="tablist"
        aria-label="Channel sections"
        className="flex gap-6 border-b border-border"
      >
        {TABS.map((tab, index) => {
          const selected = active === tab.id;

          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`channel-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`channel-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "-mb-px border-b-2 px-1 py-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="channel-panel-videos"
        aria-labelledby="channel-tab-videos"
        hidden={active !== "videos"}
        className="pt-6"
      >
        {videos}
      </div>
      <div
        role="tabpanel"
        id="channel-panel-about"
        aria-labelledby="channel-tab-about"
        hidden={active !== "about"}
        className="pt-6"
      >
        {about}
      </div>
    </div>
  );
}
