import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "~/lib/query-client";
import { qk } from "~/lib/queries/keys";
import { useAppendCardMutation } from "~/lib/queries/study";
import { TODAY_REFRESH_DEBOUNCE_MS } from "~/lib/study-writes";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { clearTauriMocks, installMockIpc } from "~/test/mock-ipc";

describe("useAppendCardMutation", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearTauriMocks();
  });

  it("marks this library's Today stale: a new card is due at once", async () => {
    vi.useFakeTimers();
    installMockIpc({ append_card: () => ({ id: "card-1" }) });
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAppendCardMutation(FIXTURE_ROOT_FALL, "cell-biology"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ front: "Q", back: "A", digest: "digests/w1.md" });
    });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: qk.todayRoot(FIXTURE_ROOT_FALL) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODAY_REFRESH_DEBOUNCE_MS);
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.todayRoot(FIXTURE_ROOT_FALL) });
  });
});
