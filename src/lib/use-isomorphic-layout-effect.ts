"use client";

import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` in the browser, `useEffect` during server rendering.
 *
 * The shell player (T75) has to claim its stage before the browser paints, or a
 * watch page would show the mini-player for one frame before docking. React
 * warns about `useLayoutEffect` in a server-rendered client component, so the
 * two effects are swapped once, at module scope, instead of per component.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
