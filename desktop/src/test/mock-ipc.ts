import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { createMockHandler, resetMockHandlerTimers } from "~/test/mock-handlers";

/** After {@link clearMocks}, Tauri `unlisten()` still needs a noop `unregisterListener`. */
function ensureEventPluginUnregisterStub(): void {
  if (typeof window.__TAURI_EVENT_PLUGIN_INTERNALS__ !== "object") {
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    return;
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = () => {};
}

/** Clears Tauri mocks without breaking in-flight event listener teardown. */
export function clearTauriMocks(): void {
  clearMocks();
  ensureEventPluginUnregisterStub();
}

export function installMockIpc(
  overrides?: Parameters<typeof createMockHandler>[0],
): void {
  resetMockHandlerTimers();
  mockIPC(createMockHandler(overrides), { shouldMockEvents: true });
}
