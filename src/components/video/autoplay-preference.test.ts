import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AUTOPLAY_PREFERENCE_KEY,
  readAutoplayPreference,
  useAutoplayPreference,
} from "./autoplay-preference";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useAutoplayPreference", () => {
  it("defaults to off when nothing is stored", () => {
    const { result } = renderHook(() => useAutoplayPreference());

    expect(result.current[0]).toBe(false);
    expect(readAutoplayPreference()).toBe(false);
    expect(window.localStorage.getItem(AUTOPLAY_PREFERENCE_KEY)).toBeNull();
  });

  it("reads a stored preference", () => {
    window.localStorage.setItem(AUTOPLAY_PREFERENCE_KEY, "true");

    const { result } = renderHook(() => useAutoplayPreference());

    expect(result.current[0]).toBe(true);
  });

  it("writes the preference and notifies every consumer", () => {
    const first = renderHook(() => useAutoplayPreference());
    const second = renderHook(() => useAutoplayPreference());

    act(() => first.result.current[1](true));

    expect(window.localStorage.getItem(AUTOPLAY_PREFERENCE_KEY)).toBe("true");
    expect(first.result.current[0]).toBe(true);
    expect(second.result.current[0]).toBe(true);
  });

  it("treats a storage failure as the safe default", () => {
    const setItem = window.localStorage.setItem;

    window.localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };

    try {
      const { result } = renderHook(() => useAutoplayPreference());

      expect(() => act(() => result.current[1](true))).not.toThrow();
      // The toggle still reflects the viewer's choice for this page.
      expect(result.current[0]).toBe(true);
    } finally {
      window.localStorage.setItem = setItem;
      window.localStorage.clear();
    }
  });
});
