import { afterEach, describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearTauriMocks } from "~/test/mock-ipc";

import { TAURI_UNAVAILABLE } from "~/domain/tauri";
import type { Command } from "~/lib/ipc";
import { invoke, openDialog } from "~/lib/ipc";

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

  it("starts a folder picker in the home folder", async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "plugin:path|resolve_directory") {
        return "/home/student";
      }
      if (cmd === "plugin:dialog|open") {
        return "/home/student/Knowledge";
      }
      return null;
    });
    await expect(openDialog({ directory: true, multiple: false })).resolves.toBe(
      "/home/student/Knowledge",
    );
    const open = calls.find((c) => c.cmd === "plugin:dialog|open");
    expect(open?.args).toMatchObject({
      options: { directory: true, multiple: false, defaultPath: "/home/student" },
    });
  });

  it("keeps an explicit start folder and leaves file pickers alone", async () => {
    const opens: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "plugin:path|resolve_directory") {
        throw new Error("home folder should not be resolved");
      }
      if (cmd === "plugin:dialog|open") {
        opens.push(args);
      }
      return null;
    });
    await openDialog({ directory: true, defaultPath: "/srv/notes" });
    await openDialog({ multiple: true });
    expect(opens[0]).toMatchObject({ options: { defaultPath: "/srv/notes" } });
    expect((opens[1] as { options: object }).options).not.toHaveProperty("defaultPath");
  });

  it("still opens the folder picker when the home folder can't be resolved", async () => {
    const opens: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "plugin:path|resolve_directory") {
        throw new Error("no home");
      }
      if (cmd === "plugin:dialog|open") {
        opens.push(args);
      }
      return null;
    });
    await openDialog({ directory: true });
    expect((opens[0] as { options: object }).options).not.toHaveProperty("defaultPath");
  });
});

// Compile-time guard: list_providers must not be a Command.
type ExpectExcluded = "list_providers" extends Command ? true : false;
const _listProvidersExcluded: ExpectExcluded = false;
void _listProvidersExcluded;
