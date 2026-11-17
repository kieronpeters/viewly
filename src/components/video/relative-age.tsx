"use client";

import { useEffect, useState } from "react";

import { formatRelativeAge } from "./format-relative-age";

/**
 * Relative publish age ("2d ago"), rendered on the client only.
 *
 * The server has no stable "now": reading the clock during prerender is what
 * Next's Cache Components flags as an unstable value. The first paint therefore
 * renders an empty span and the effect fills it in after hydration, which is
 * also what keeps the server and client markup identical.
 */
export function RelativeAge({ publishedAt }: { publishedAt: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    setLabel(formatRelativeAge(publishedAt) ?? "");
  }, [publishedAt]);

  return <>{label}</>;
}
