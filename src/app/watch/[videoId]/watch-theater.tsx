"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { useTheaterPreference } from "./theater-preference";

/** The shared theater state and its toggle, as consumed by the page. */
export interface WatchTheaterControls {
  /** Whether the player column currently spans the full watch grid. */
  isTheater: boolean;
  /** Flips theater mode through the persisted preference. */
  toggleTheater: () => void;
}

const WatchTheaterContext = createContext<WatchTheaterControls | null>(null);

/**
 * Provides one theater state to the watch page (T70).
 *
 * Theater is a layout concern shared by three separate client surfaces — the
 * grid, the persisted toggle and the player's `T` shortcut — so it lives in a
 * context instead of being threaded through server-rendered children. The
 * provider is a small client boundary around the still-server-rendered
 * description and discussion.
 */
export function WatchTheaterProvider({ children }: { readonly children: ReactNode }) {
  const [isTheater, setTheater] = useTheaterPreference();
  const toggleTheater = useCallback(() => {
    setTheater(!isTheater);
  }, [isTheater, setTheater]);

  const value = useMemo<WatchTheaterControls>(
    () => ({ isTheater, toggleTheater }),
    [isTheater, toggleTheater],
  );

  return <WatchTheaterContext.Provider value={value}>{children}</WatchTheaterContext.Provider>;
}

/**
 * Theater controls, or `null` outside a watch page.
 *
 * A component rendered in isolation (a preview or a unit test) gets no control
 * rather than a switch that cannot change anything.
 */
export function useWatchTheaterControls(): WatchTheaterControls | null {
  return useContext(WatchTheaterContext);
}

/** Stable fallback so an unwrapped player's `T` key remains the old no-op. */
const NO_THEATER_CONTROLS: WatchTheaterControls = {
  isTheater: false,
  toggleTheater: () => {},
};

/**
 * Theater controls for components that always render but may be mounted
 * outside the watch page, such as {@link WatchPlayer} in isolation.
 */
export function useWatchTheater(): WatchTheaterControls {
  return useContext(WatchTheaterContext) ?? NO_THEATER_CONTROLS;
}
