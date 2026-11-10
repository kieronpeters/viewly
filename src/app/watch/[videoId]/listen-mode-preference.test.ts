import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  LISTEN_MODE_PREFERENCE_KEY,
  readListenModePreference,
  useListenModePreference,
} from "./listen-mode-preference";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useListenModePreference", () => {
  it("defaults to the normal video layout when nothing is stored", () => {
    const { result } = renderHook(() => useListenModePreference());

    expect(result.current[0]).toBe(false);
    expect(readListenModePreference()).toBe(false);
    expect(window.localStorage.getItem(LISTEN_MODE_PREFERENCE_KEY)).toBeNull();
  });

  it("reads a stored listen preference", () => {
    window.localStorage.setItem(LISTEN_MODE_PREFERENCE_KEY, "true");

    const { result } = renderHook(() => useListenModePreference());

    expect(result.current[0]).toBe(true);
  });

  it("writes the preference and notifies every consumer", () => {
    const first = renderHook(() => useListenModePreference());
    const second = renderHook(() => useListenModePreference());

    act(() => first.result.current[1](true));

    expect(window.localStorage.getItem(LISTEN_MODE_PREFERENCE_KEY)).toBe("true");
    expect(first.result.current[0]).toBe(true);
    expect(second.result.current[0]).toBe(true);

    act(() => second.result.current[1](false));

    expect(window.localStorage.getItem(LISTEN_MODE_PREFERENCE_KEY)).toBe("false");
    expect(first.result.current[0]).toBe(false);
  });

  it("treats a storage failure as the safe default", () => {
    const setItem = window.localStorage.setItem;

    window.localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };

    try {
      const { result } = renderHook(() => useListenModePreference());

      expect(() => act(() => result.current[1](true))).not.toThrow();
      // The switch still reflects the viewer's choice for this page.
      expect(result.current[0]).toBe(true);
    } finally {
      window.localStorage.setItem = setItem;
      window.localStorage.clear();
    }
  });

  it("ignores a malformed stored value", () => {
    window.localStorage.setItem(LISTEN_MODE_PREFERENCE_KEY, "yes");

    const { result } = renderHook(() => useListenModePreference());

    expect(result.current[0]).toBe(false);
  });
});
