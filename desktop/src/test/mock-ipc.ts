import { mockIPC } from "@tauri-apps/api/mocks";

import { createMockHandler } from "~/test/mock-handlers";

export function installMockIpc(
  overrides?: Parameters<typeof createMockHandler>[0],
): void {
  mockIPC(createMockHandler(overrides), { shouldMockEvents: true });
}
