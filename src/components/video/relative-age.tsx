"use client";

import { useSyncExternalStore } from "react";

import { formatRelativeAge } from "./format-relative-age";

/** The age never triggers a subscription: it is a snapshot, read on render. */
function subscribe(): () => void {
  return () => {};
}

/**
 * Relative publish age ("2d ago"), resolved on the client only.
 *
 * The server has no stable "now": reading the clock during prerender is what
 * Next's Cache Components flags as an unstable value, and setting state from an
 * effect would flash and cascade renders. `useSyncExternalStore` gives the
 * server an empty snapshot and the client a computed one, so hydration is
 * consistent and the clock is only ever read in the browser.
 */
export function RelativeAge({ publishedAt }: { publishedAt: string }) {
  const label = useSyncExternalStore(
    subscribe,
    () => formatRelativeAge(publishedAt) ?? "",
    () => "",
  );

  return <>{label}</>;
}
