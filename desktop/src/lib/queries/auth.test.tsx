import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { createAppQueryClient } from "~/lib/query-client";
import { useAuth } from "~/lib/queries/auth";
import { installMockIpc } from "~/test/mock-ipc";
import { getMockIpcLog, clearMockIpcLog } from "~/test/mock-handlers";

let sharedClient = createAppQueryClient();

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={sharedClient}>{children}</QueryClientProvider>;
}

function DualAuth() {
  useAuth("grok");
  useAuth("grok");
  return null;
}

describe("useAuth", () => {
  beforeEach(() => {
    clearTauriMocks();
    clearMockIpcLog();
    resetAuthRefreshForTests();
    sharedClient = createAppQueryClient();
    installMockIpc();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces concurrent checks into one IPC call", async () => {
    renderHook(DualAuth, { wrapper });
    await waitFor(
      () => {
        expect(getMockIpcLog().filter((c) => c === "check_auth")).toHaveLength(1);
      },
      { timeout: 3000 },
    );
  });

  it("does not refetch on refocus within 60s", async () => {
    renderHook(() => useAuth("grok"), { wrapper });
    await waitFor(() => expect(getMockIpcLog().filter((c) => c === "check_auth").length).toBe(1));
    clearMockIpcLog();
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(getMockIpcLog().filter((c) => c === "check_auth")).toHaveLength(0);
  });

  it("refetches on refocus after 60s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useAuth("grok"), { wrapper });
    await vi.advanceTimersByTimeAsync(400);
    clearMockIpcLog();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(getMockIpcLog().filter((c) => c === "check_auth")).toHaveLength(0);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(getMockIpcLog().filter((c) => c === "check_auth")).toHaveLength(1);
  });

  it("does not poll on an interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useAuth("grok"), { wrapper });
    await vi.advanceTimersByTimeAsync(400);
    clearMockIpcLog();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getMockIpcLog().filter((c) => c === "check_auth")).toHaveLength(0);
  });
});
