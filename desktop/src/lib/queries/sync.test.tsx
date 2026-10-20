import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { createAppQueryClient } from "~/lib/query-client";
import { qk } from "~/lib/queries/keys";
import { useSyncContinueMutation, useSyncNowMutation } from "~/lib/queries/sync";
import { useSyncUiStore } from "~/stores/sync-ui-store";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { installMockIpc } from "~/test/mock-ipc";

describe("sync mutations", () => {
  afterEach(() => {
    clearTauriMocks();
    useSyncUiStore.setState({ syncConflictOpen: false });
  });

  it("useSyncNowMutation sets conflict flag without reload", async () => {
    installMockIpc({
      sync_now: () => ({
        ok: false,
        action: "conflict",
        head_changed: false,
        files: ["a.md"],
      }),
    });
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useSyncNowMutation(FIXTURE_ROOT_FALL, "cell-biology"),
      { wrapper },
    );
    await result.current.mutateAsync();
    expect(useSyncUiStore.getState().syncConflictOpen).toBe(true);
  });

  it("useSyncNowMutation reloads library when head_changed", async () => {
    installMockIpc({
      sync_now: () => ({
        ok: true,
        action: "pull",
        head_changed: true,
      }),
    });
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useSyncNowMutation(FIXTURE_ROOT_FALL, "cell-biology"),
      { wrapper },
    );
    await result.current.mutateAsync();
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.library(FIXTURE_ROOT_FALL) });
  });

  it("useSyncContinueMutation reloads when head_changed", async () => {
    installMockIpc({
      sync_continue: () => ({
        ok: true,
        action: "integrated",
        head_changed: true,
      }),
    });
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useSyncContinueMutation(FIXTURE_ROOT_FALL, "cell-biology"),
      { wrapper },
    );
    await result.current.mutateAsync();
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.courses(FIXTURE_ROOT_FALL) });
  });
});
