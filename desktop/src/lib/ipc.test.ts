import { afterEach, describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearTauriMocks } from "~/test/mock-ipc";

import { TAURI_UNAVAILABLE } from "~/domain/tauri";
import type { Command } from "~/lib/ipc";
import { invoke } from "~/lib/ipc";

describe("ipc", () => {
  afterEach(() => {
    clearTauriMocks();
  });

  it("preserves error messages verbatim", async () => {
    mockIPC(() => {
      throw "worker server exited";
    });
    await expect(invoke("get_settings")).rejects.toThrow("worker server exited");
  });

  it("rejects outside Tauri", async () => {
    clearTauriMocks();
    await expect(invoke("get_settings")).rejects.toThrow(TAURI_UNAVAILABLE);
  });

});

// Compile-time guard: list_providers must not be a Command.
type ExpectExcluded = "list_providers" extends Command ? true : false;
const _listProvidersExcluded: ExpectExcluded = false;
void _listProvidersExcluded;
