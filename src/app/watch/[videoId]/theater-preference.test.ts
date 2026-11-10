import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  THEATER_PREFERENCE_KEY,
  readTheaterPreference,
  useTheaterPreference,
} from "./theater-preference";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useTheaterPreference", () => {
  it("defaults to the normal watch layout when nothing is stored", () => {
    const { result } = renderHook(() => useTheaterPreference());

    expect(result.current[0]).toBe(false);
    expect(readTheaterPreference()).toBe(false);
    expect(window.localStorage.getItem(THEATER_PREFERENCE_KEY)).toBeNull();
  });

  it("uses a versioned local-only key", () => {
    expect(THEATER_PREFERENCE_KEY).toBe("viewly:watch-theater:v1");
  });

  it("reads a stored theater preference", () => {
    window.localStorage.setItem(THEATER_PREFERENCE_KEY, "true");

    const { result } = renderHook(() => useTheaterPreference());

    expect(result.current[0]).toBe(true);
  });

  it("writes the preference and notifies every consumer", () => {
    const first = renderHook(() => useTheaterPreference());
    const second = renderHook(() => useTheaterPreference());

    act(() => first.result.current[1](true));

    expect(window.localStorage.getItem(THEATER_PREFERENCE_KEY)).toBe("true");
    expect(first.result.current[0]).toBe(true);
    expect(second.result.current[0]).toBe(true);

    act(() => second.result.current[1](false));

    expect(window.localStorage.getItem(THEATER_PREFERENCE_KEY)).toBe("false");
    expect(first.result.current[0]).toBe(false);
  });

  it("treats a storage failure as the safe default", () => {
    const setItem = window.localStorage.setItem;

    window.localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };

    try {
      const { result } = renderHook(() => useTheaterPreference());

      expect(() => act(() => result.current[1](true))).not.toThrow();
      // The toggle still reflects the viewer's choice for this page.
      expect(result.current[0]).toBe(true);
    } finally {
      window.localStorage.setItem = setItem;
      window.localStorage.clear();
    }
  });

  it("ignores a malformed stored value", () => {
    window.localStorage.setItem(THEATER_PREFERENCE_KEY, "yes");

    const { result } = renderHook(() => useTheaterPreference());

    expect(result.current[0]).toBe(false);
  });
});
