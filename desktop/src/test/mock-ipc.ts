import { mockIPC } from "@tauri-apps/api/mocks";

import { createMockHandler, resetMockHandlerTimers } from "~/test/mock-handlers";

export function installMockIpc(
  overrides?: Parameters<typeof createMockHandler>[0],
): void {
  resetMockHandlerTimers();
  mockIPC(createMockHandler(overrides), { shouldMockEvents: true });
}
