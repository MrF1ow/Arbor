import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { createAppQueryClient } from "~/lib/query-client";
import {
  useActivateKnowledgeRootMutation,
  usePendingActiveRootSwitch,
  useSwitchActiveRootMutation,
} from "~/lib/queries/active-root";
import { qk } from "~/lib/queries/keys";
import { useJobStore } from "~/stores/job-store";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcCalls, getMockIpcLog } from "~/test/mock-handlers";
import { installMockIpc } from "~/test/mock-ipc";

/** Real Tauri IPC is never instant: answer after a short delay, as the app sees it. */
function later<T>(value: T, ms = 10): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("active root mutations", () => {
  afterEach(() => {
    clearTauriMocks();
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

  it("overlapping switches run in order: the second still saves when the first one's save has not landed yet", async () => {
    // The backend holds a save only once it has landed, and answers get_settings with what it holds
    // when asked: a second switch that reads settings while the first is still saving sees the
    // first's library as not yet active.
    let backend = fixtureSettings;
    const events: string[] = [];
    clearMockIpcLog();
    installMockIpc({
      get_settings: () => {
        events.push("get_settings");
        return later(backend);
      },
      save_settings: (args) => {
        const next = (args as { settings: typeof fixtureSettings }).settings;
        events.push(`save ${next.active_root}`);
        return later(null, 100).then(() => {
          backend = next;
          events.push(`landed ${next.active_root}`);
          return null;
        });
      },
      start_folder_watch: () => later(null),
    });
    const client = createAppQueryClient();
    client.setQueryData(qk.settings(), fixtureSettings);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSwitchActiveRootMutation(), { wrapper });

    // Away from the active library, then straight back (browser Back, then Forward).
    const first = result.current.mutateAsync(FIXTURE_ROOT_SHARED);
    const second = result.current.mutateAsync(FIXTURE_ROOT_FALL);
    await Promise.all([first, second]);

    expect(events.filter((e) => e.startsWith("save"))).toEqual([
      `save ${FIXTURE_ROOT_SHARED}`,
      `save ${FIXTURE_ROOT_FALL}`,
    ]);
    expect(backend.active_root).toBe(FIXTURE_ROOT_FALL);
    // The second switch read settings only after the first one's save had landed.
    const landed = events.indexOf(`landed ${FIXTURE_ROOT_SHARED}`);
    const secondRead = events.indexOf("get_settings", events.indexOf(`save ${FIXTURE_ROOT_SHARED}`));
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(secondRead).toBeGreaterThan(landed);
  });

  it("a failed switch does not stop the next one", async () => {
    let backend = fixtureSettings;
    let failNext = true;
    installMockIpc({
      get_settings: () => later(backend),
      save_settings: (args) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("disk full"));
        }
        backend = (args as { settings: typeof fixtureSettings }).settings;
        return later(null);
      },
      start_folder_watch: () => later(null),
    });
    const client = createAppQueryClient();
    client.setQueryData(qk.settings(), fixtureSettings);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSwitchActiveRootMutation(), { wrapper });
    const failed = result.current.mutateAsync(FIXTURE_ROOT_SHARED);
    const next = result.current.mutateAsync(FIXTURE_ROOT_SHARED);
    await expect(failed).rejects.toThrow("disk full");
    await next;
    expect(backend.active_root).toBe(FIXTURE_ROOT_SHARED);
  });

  it("reports the newest requested root while switches are queued, and null once they have all landed", async () => {
    installMockIpc({
      get_settings: () => later(fixtureSettings),
      save_settings: () => later(null, 50),
      start_folder_watch: () => later(null),
    });
    const client = createAppQueryClient();
    client.setQueryData(qk.settings(), fixtureSettings);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({ switchRoot: useSwitchActiveRootMutation(), pending: usePendingActiveRootSwitch() }),
      { wrapper },
    );
    expect(result.current.pending).toBeNull();
    let all: Promise<unknown> = Promise.resolve();
    await act(async () => {
      all = Promise.all([
        result.current.switchRoot.mutateAsync(FIXTURE_ROOT_SHARED),
        result.current.switchRoot.mutateAsync(FIXTURE_ROOT_FALL),
      ]);
    });
    // Both are queued; the newest request is the target.
    expect(result.current.pending).toBe(FIXTURE_ROOT_FALL);
    await act(async () => {
      await all;
    });
    expect(result.current.pending).toBeNull();
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
