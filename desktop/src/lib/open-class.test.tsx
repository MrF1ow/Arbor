import { RouterContextProvider } from "@tanstack/react-router";
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { classPath } from "~/lib/class-path";
import { useOpenClass } from "~/lib/open-class";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { getMockIpcCalls, clearMockIpcLog, resetMockSettingsForTests } from "~/test/mock-handlers";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderWithProviders } from "~/test/render";

async function mount() {
  resetMockSettingsForTests();
  const rendered = renderWithProviders(<></>, { seedSettings: fixtureSettings });
  clearMockIpcLog();
  await rendered.router.load();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <rendered.Wrapper>
      <RouterContextProvider router={rendered.router}>{children}</RouterContextProvider>
    </rendered.Wrapper>
  );
  return { ...renderHook(() => useOpenClass(), { wrapper }), router: rendered.router };
}

describe("useOpenClass", () => {
  afterEach(() => clearTauriMocks());

  it("navigates straight away when the class is in the active library", async () => {
    const { result, router } = await mount();
    await act(async () => {
      await result.current(FIXTURE_ROOT_FALL, "cell-biology", "cards");
    });
    expect(router.state.location.pathname).toBe(classPath("cell-biology", "cards").to.replace("$course", "cell-biology"));
    const saved = getMockIpcCalls().filter((c) => c.cmd === "save_settings");
    expect(saved).toHaveLength(0);
  });

  it("switches the active library first when the class is in another one (Q10)", async () => {
    const { result, router } = await mount();
    await act(async () => {
      await result.current(FIXTURE_ROOT_SHARED, "collab-notes", "quiz", { lectures: "x" });
    });
    const saved = getMockIpcCalls().filter((c) => c.cmd === "save_settings");
    expect(saved).toHaveLength(1);
    expect((saved[0]!.args as { settings: { active_root: string } }).settings.active_root).toBe(
      FIXTURE_ROOT_SHARED,
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/collab-notes/practice/quiz");
    });
    expect(router.state.location.search).toEqual({ lectures: "x" });
  });

  it("opens a digest on the read tab", async () => {
    const { result, router } = await mount();
    await act(async () => {
      await result.current(FIXTURE_ROOT_FALL, "cell-biology", { tab: "read", digest: "2026-09-12-membranes" });
    });
    expect(router.state.location.pathname).toBe("/course/cell-biology/read/2026-09-12-membranes");
  });
});
