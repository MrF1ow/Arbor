import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { createAppQueryClient } from "~/lib/query-client";
import { useModels, useRefreshModels } from "~/lib/queries/workers";
import { installMockIpc } from "~/test/mock-ipc";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";

describe("useModels", () => {
  afterEach(() => {
    clearTauriMocks();
  });

  it("does not refetch on remount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installMockIpc();
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useModels("grok", "/mock/a"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    clearMockIpcLog();
    first.unmount();
    renderHook(() => useModels("grok", "/mock/a"), { wrapper });
    await vi.advanceTimersByTimeAsync(100);
    expect(getMockIpcLog().filter((c) => c === "list_models")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("refetches after refreshModels and root changes", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      ({ root }: { root: string }) => {
        const models = useModels("grok", root);
        const refresh = useRefreshModels();
        return { models, refresh };
      },
      { wrapper, initialProps: { root: "/mock/a" } },
    );
    await waitFor(() => expect(hook.result.current.models.isSuccess).toBe(true));
    clearMockIpcLog();
    hook.result.current.refresh("grok", "/mock/a");
    await waitFor(() => expect(getMockIpcLog().filter((c) => c === "list_models")).toHaveLength(1));
    clearMockIpcLog();
    hook.rerender({ root: "/mock/b" });
    await waitFor(() => expect(getMockIpcLog().filter((c) => c === "list_models")).toHaveLength(1));
  });
});
