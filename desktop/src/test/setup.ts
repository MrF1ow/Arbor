import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { cleanupTestQueryClients } from "~/test/query-clients";

export const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

Object.defineProperty(navigator, "clipboard", {
  value: { writeText: clipboardWriteText },
  configurable: true,
});

const storage = new Map<string, string>();
if (typeof globalThis.localStorage?.clear !== "function") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    },
    configurable: true,
  });
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  });
}

afterEach(async () => {
  await cleanupTestQueryClients();
  cleanup();
  vi.clearAllTimers();
});
