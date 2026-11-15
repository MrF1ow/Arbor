import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { clearTauriMocks } from "~/test/mock-ipc";
import { cleanupTestQueryClients } from "~/test/query-clients";

// The full suite runs every file in parallel. Under load a render can take longer
// than testing-library's default 1s waitFor window, so slow machines failed tests
// that pass alone. A longer window only changes how long a failing wait retries.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });

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
  // A library switch still in flight when a test ends must not hold the next test's switches back,
  // or save into its mocks. Imported here, not at the top: its modules build the persisted UI store,
  // which must find the localStorage shim above, and a test file's own mocks must come first.
  const { resetActiveRootSwitchQueueForTests } = await import("~/lib/queries/active-root");
  resetActiveRootSwitchQueueForTests();
  await cleanupTestQueryClients();
  cleanup();
  vi.clearAllTimers();
  clearTauriMocks();
});
