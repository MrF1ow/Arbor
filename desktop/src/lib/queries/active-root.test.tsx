import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { createAppQueryClient } from "~/lib/query-client";
import {
  useActivateKnowledgeRootMutation,
  useSwitchActiveRootMutation,
} from "~/lib/queries/active-root";
import { useJobStore } from "~/stores/job-store";
import { FIXTURE_ROOT_FALL, fixtureSettings } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcCalls, getMockIpcLog } from "~/test/mock-handlers";
import { installMockIpc } from "~/test/mock-ipc";

describe("active root mutations", () => {
  afterEach(() => {
    clearMocks();
  });

  it("useSwitchActiveRootMutation is a no-op when root is already active", async () => {
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      lines: ["keep-me"],
      unread: 0,
    });
    clearMockIpcLog();
    installMockIpc({
      get_settings: () => fixtureSettings,
    });
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSwitchActiveRootMutation(), { wrapper });
    await result.current.mutateAsync(FIXTURE_ROOT_FALL);
    expect(getMockIpcLog()).not.toContain("save_settings");
    expect(getMockIpcLog()).not.toContain("start_folder_watch");
    expect(useJobStore.getState().lines).toEqual(["keep-me"]);
  });

  it("useActivateKnowledgeRootMutation continues when init_knowledge_repo fails", async () => {
    clearMockIpcLog();
    installMockIpc({
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_roots: [],
        knowledge_root: null,
        active_root: null,
      }),
      init_knowledge_repo: () => {
        throw new Error("git missing");
      },
    });
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useActivateKnowledgeRootMutation(), { wrapper });
    const out = await result.current.mutateAsync("/mock/new-root");
    expect(out.initRepoError).toBe("git missing");
    expect(out.repoCreated).toBe(false);
    const log = getMockIpcLog();
    expect(log).toContain("save_settings");
    expect(log).toContain("init_arbor_db");
    expect(log).toContain("start_folder_watch");
    const saveCall = getMockIpcCalls().find((c) => c.cmd === "save_settings");
    const settings = (saveCall?.args as { settings?: { active_root?: string } })?.settings;
    expect(settings?.active_root).toBe("/mock/new-root");
  });
});
