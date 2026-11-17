import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Node 26 registers a global `localStorage` accessor that returns `undefined` unless the
 * process was started with `--localstorage-file`. jsdom's `window` then resolves
 * `window.localStorage` to that global instead of its own in-memory Storage, so every test
 * that exercises persistence breaks with "Cannot read properties of undefined (reading
 * 'clear')". `sessionStorage` is unaffected.
 *
 * Provide the jsdom-style Storage only when it is missing. On Node 22/24, or when the flag
 * is supplied, jsdom's own implementation is already present and this block is a no-op.
 */
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  const entries = new Map<string, string>();
  const METHODS = new Set(["getItem", "setItem", "removeItem", "clear", "key", "length"]);

  const api = {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.has(key) ? (entries.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(String(key), String(value));
    },
  };

  /**
   * jsdom's real Storage is a proxy: writing a storage key works, but assigning over a
   * method (`storage.setItem = …`) is ignored. Tests rely on that (they stub `setItem`
   * while expecting persistence to keep working), so mirror it here instead of handing
   * out a plain object.
   */
  const storage = new Proxy(api, {
    set(target, property, value) {
      if (typeof property === "string" && !METHODS.has(property)) {
        entries.set(property, String(value));
      }
      return true;
    },
    get(target, property, receiver) {
      if (typeof property === "string" && !METHODS.has(property)) {
        return entries.has(property) ? entries.get(property) : undefined;
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return typeof property === "string" && (METHODS.has(property) || entries.has(property));
    },
  }) as unknown as Storage;

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
}

afterEach(() => {
  cleanup();
});
