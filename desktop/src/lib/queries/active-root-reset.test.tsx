import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "~/lib/query-client";
import { setActiveRootSwitchTimeoutForTests, useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { installMockIpc } from "~/test/mock-ipc";

const later = <T,>(v: T, ms = 10) => new Promise<T>((r) => setTimeout(() => r(v), ms));
let saved = false;

describe("a folder watch still in flight when a test ends", () => {
  it("test A: a switch whose folder watch hangs is still in finishSwitch when the test ends", async () => {
    setActiveRootSwitchTimeoutForTests(300);
    installMockIpc({
      get_settings: () => later(fixtureSettings),
      save_settings: () => later(null).then(() => { saved = true; return null; }),
      start_folder_watch: () => new Promise<never>(() => undefined),
    });
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSwitchActiveRootMutation(), { wrapper });
    void result.current.mutateAsync(FIXTURE_ROOT_SHARED).catch(() => undefined);
    await waitFor(() => expect(saved).toBe(true));
    await later(null, 20); // the folder watch is now in flight; the test ends (setup.ts resets the queue)
  });

  it("test B: no warning from test A's switch reaches this test", async () => {
    const warn = vi.spyOn(toast, "warning");
    await later(null, 600);
    expect(warn).not.toHaveBeenCalled();
  });
});
