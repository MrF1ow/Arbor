import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ROOT_FALL, fixtureKnowledgeSettings, fixtureSettings } from "~/test/fixtures/data";
import {
  fixtureLibraryShowEditor,
  fixtureLibraryShowOwner,
  fixtureLibraryShowOwnerNoProvider,
  fixtureLibraryShowViewer,
  fixtureSkillPackages,
  fixtureSyncConflictSession,
} from "~/test/fixtures/settings-sharing";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { clearTauriMocks } from "~/test/mock-ipc";
import * as ipcModule from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { resetSaveSettingsChainForTests } from "~/lib/queries/settings";
import { useSyncUiStore } from "~/stores/sync-ui-store";
import { useUiStore } from "~/stores/ui-store";
import { renderAppAtRoute } from "~/test/render";
import { toast } from "sonner";

function settingsView() {
  return screen.getByTestId("settings-view");
}

describe("settings sharing (14b)", () => {
  beforeEach(() => {
    resetSaveSettingsChainForTests();
    useSyncUiStore.setState({ syncConflictOpen: false });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    clearMockIpcLog();
    vi.restoreAllMocks();
  });

  it("renders library create/join when no library is present", async () => {
    await renderAppAtRoute("/settings/library");
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-library")).toBeInTheDocument();
      expect(within(settingsView()).getByRole("button", { name: "Create shared library" })).toBeInTheDocument();
    });
  });

  it("create shared library sends payload and invalidates library", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library");
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Create shared library" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Create shared library" }));
    await user.click(await screen.findByRole("button", { name: "Create" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "create_shared_library");
      expect(call?.args).toMatchObject({ root: FIXTURE_ROOT_FALL });
      expect(getMockIpcCalls().some((c) => c.cmd === "save_settings")).toBe(true);
    });
  });

  it("owner can save library members", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowOwner,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Save members" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Save members" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "library_set_members");
      expect(call?.args).toMatchObject({ root: FIXTURE_ROOT_FALL });
    });
  });

  it("viewer sees read-only members note", async () => {
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowViewer,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByText(/Only an owner can edit library members/)).toBeInTheDocument();
      expect(within(settingsView()).getByTestId("library-role-note-settings")).toBeInTheDocument();
    });
  });

  it("rejects invalid member email", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowOwner,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByLabelText("Member email")).toBeInTheDocument();
    });
    await user.type(within(settingsView()).getByLabelText("Member email"), "not-an-email");
    await user.click(within(settingsView()).getByRole("button", { name: "Add" }));
    expect(within(settingsView()).getByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("library provider save and clear invoke library_set_provider", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowOwner,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Save provider" })).toBeInTheDocument();
    });
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Save provider" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "library_set_provider")).toBe(true);
    });
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Clear provider" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "library_set_provider");
      expect((call?.args as { clear?: boolean })?.clear).toBe(true);
    });
  });

  it("sync save remote calls sync_set_remote and shows status", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync", {
      sync_show: () => ({ remote: "git@example.com:repo.git", shared: false, remote_note: null }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-sync")).toBeInTheDocument();
    });
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Save remote" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "sync_set_remote")).toBe(true);
      expect(within(settingsView()).getByTestId("sync-status")).toHaveTextContent("Remote saved.");
    });
  });

  it("sync shared switch calls sync_set_shared", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync", {
      sync_show: () => ({ remote: null, shared: false }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("switch", { name: "Shared library (merge on sync)" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("switch", { name: "Shared library (merge on sync)" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "sync_set_shared")).toBe(true);
    });
  });

  it("sync after commit persists via save_knowledge_settings", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync");
    await waitFor(() => {
      expect(
        within(settingsView()).getByRole("switch", { name: "Sync after each committed job" }),
      ).toBeInTheDocument();
    });
    await user.click(
      within(settingsView()).getByRole("switch", { name: "Sync after each committed job" }),
    );
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "save_knowledge_settings")).toBe(true);
    });
  });

  it("sync now opens conflict dialog on conflict", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync", {
      sync_now: () => ({
        ok: false,
        action: "conflict",
        files: ["cell-biology/course.md"],
      }),
      read_sync_conflict: () => fixtureSyncConflictSession,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Sync now" }));
    await waitFor(() => {
      expect(useSyncUiStore.getState().syncConflictOpen).toBe(true);
    });
  });

  it("conflict dialog resolves text with sync_resolve", async () => {
    useSyncUiStore.setState({ syncConflictOpen: true });
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync", {
      read_sync_conflict: () => fixtureSyncConflictSession,
    });
    const dialog = await screen.findByTestId("sync-conflict-dialog");
    const useMine = await within(dialog).findByRole("button", { name: "Use mine" });
    await user.click(useMine);
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "sync_resolve");
      expect(call?.args).toMatchObject({ side: "mine", path: "cell-biology/course.md" });
    });
  });

  it("skills save index preserves unrelated settings fields", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/skills", {
      get_settings: () => ({
        ...fixtureSettings,
        provider_id: "grok",
        ollama_base_url: "http://127.0.0.1:11434",
      }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Save index" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Save index" }));
    await waitFor(() => {
      const save = getMockIpcCalls().find((c) => c.cmd === "save_settings");
      const settings = (save?.args as { settings?: typeof fixtureSettings })?.settings;
      expect(settings?.provider_id).toBe("grok");
      expect(settings?.ollama_base_url).toBe("http://127.0.0.1:11434");
      expect(settings?.skill_index_source).toBeDefined();
    });
  });

  it("browse renders skill packages", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/skills", {
      skill_index: () => ({ packages: fixtureSkillPackages }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Browse index" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Browse index" }));
    await waitFor(() => {
      expect(within(settingsView()).getByText("Demo skill")).toBeInTheDocument();
      expect(within(settingsView()).getByText("New permissions")).toBeInTheDocument();
    });
  });

  it("install with new permissions opens confirm then skill_install", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/skills", {
      skill_index: () => ({ packages: fixtureSkillPackages }),
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Browse index" }));
    await waitFor(() => {
      expect(within(settingsView()).getByText("New permissions")).toBeInTheDocument();
    });
    const installButtons = within(settingsView()).getAllByRole("button", { name: "Install" });
    await user.click(installButtons.at(-1)!);
    await waitFor(() => {
      expect(screen.getByTestId("skill-permissions-dialog")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "save_settings")).toBe(true);
      expect(getMockIpcCalls().some((c) => c.cmd === "skill_install")).toBe(true);
    });
  });

  it("workers add persists worker and preserves other settings", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/workers", {
      get_settings: () => ({
        ...fixtureSettings,
        appearance: "dark",
      }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByLabelText("Worker label")).toBeInTheDocument();
    });
    await user.type(within(settingsView()).getByLabelText("Worker label"), "GPU");
    await user.type(within(settingsView()).getByLabelText("Worker host"), "gpu.local");
    await user.type(within(settingsView()).getByLabelText("Worker command"), "uv run arbor-worker");
    await user.type(within(settingsView()).getByLabelText("Remote root"), "/data");
    await user.click(within(settingsView()).getByRole("button", { name: "Add worker" }));
    await waitFor(() => {
      const save = getMockIpcCalls().find((c) => c.cmd === "save_settings");
      const settings = (save?.args as { settings?: typeof fixtureSettings })?.settings;
      expect(settings?.appearance).toBe("dark");
      expect(settings?.workers?.length).toBe(1);
    });
  });

  it("workers invalid port shows legacy error", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/workers");
    await waitFor(() => {
      expect(within(settingsView()).getByLabelText("Worker port")).toBeInTheDocument();
    });
    await user.type(within(settingsView()).getByLabelText("Worker label"), "GPU");
    await user.type(within(settingsView()).getByLabelText("Worker host"), "gpu.local");
    await user.type(within(settingsView()).getByLabelText("Worker port"), "99999");
    await user.type(within(settingsView()).getByLabelText("Worker command"), "cmd");
    await user.type(within(settingsView()).getByLabelText("Remote root"), "/data");
    await user.click(within(settingsView()).getByRole("button", { name: "Add worker" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("worker-status")).toHaveTextContent(
        "Port must be between 1 and 65535.",
      );
    });
  });

  it("test worker connection shows status", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/workers");
    await user.type(within(settingsView()).getByLabelText("Worker label"), "GPU");
    await user.type(within(settingsView()).getByLabelText("Worker host"), "gpu.local");
    await user.type(within(settingsView()).getByLabelText("Worker command"), "cmd");
    await user.type(within(settingsView()).getByLabelText("Remote root"), "/data");
    await user.click(within(settingsView()).getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "test_worker_connection")).toBe(true);
      expect(within(settingsView()).getByTestId("worker-status")).toHaveTextContent("arbor-worker");
    });
  });

  it("provider page shows library recommendation after library provider save", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowOwner,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Save provider" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Save provider" }));
    await user.click(within(settingsView()).getByRole("button", { name: "Provider & models" }));
    await waitFor(() => {
      expect(within(settingsView()).getByText("recommended by library")).toBeInTheDocument();
    });
  });

  it("does not read sync conflict on startup", async () => {
    clearMockIpcLog();
    await renderAppAtRoute("/settings/sync");
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-sync")).toBeInTheDocument();
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "read_sync_conflict")).toBe(false);
  });

  it("sync now conflict shows resolve toast action", async () => {
    const toastSpy = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync", {
      sync_now: () => ({
        ok: false,
        action: "conflict",
        files: ["cell-biology/course.md"],
      }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Sync now" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        "Sync conflict.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Resolve conflicts" }),
        }),
      );
    });
  });

  it("create library uses null name and persists returned doc name", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library");
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Create shared library" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Create shared library" }));
    await user.clear(await screen.findByLabelText("Library name"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      const create = getMockIpcCalls().find((c) => c.cmd === "create_shared_library");
      expect(create?.args).toMatchObject({ root: FIXTURE_ROOT_FALL, name: null });
      const save = getMockIpcCalls().find((c) => c.cmd === "save_settings");
      const roots = (save?.args as { settings?: typeof fixtureSettings })?.settings?.knowledge_roots;
      expect(roots?.find((e) => e.path === FIXTURE_ROOT_FALL)?.name).toBe("Shared library");
    });
  });

  it("join library starts folder watch on joined root", async () => {
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue("/mock/knowledge/joined");
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library");
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Join a library" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Join a library" }));
    await user.type(await screen.findByLabelText("Library URL"), "git@host:repo.git");
    await user.click(screen.getByRole("button", { name: "Choose folder…" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => {
      expect(
        getMockIpcCalls().some(
          (c) =>
            c.cmd === "start_folder_watch" &&
            (c.args as { root?: string })?.root === "/mock/knowledge/joined",
        ),
      ).toBe(true);
    });
  });

  it("library_set_members sends updated roles", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowOwner,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Save members" })).toBeInTheDocument();
    });
    const roleSelect = within(settingsView()).getAllByLabelText(/Role for /)[1]!;
    await user.click(roleSelect);
    await user.click(await screen.findByRole("option", { name: "viewer" }));
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Save members" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "library_set_members");
      const members = (call?.args as { members?: { email: string; role: string }[] })?.members;
      expect(members?.find((m) => m.email === "editor@example.com")?.role).toBe("viewer");
    });
  });

  it("editor sees member note and can save provider", async () => {
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowEditor,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByText(/Only an owner can edit library members/)).toBeInTheDocument();
      expect(within(settingsView()).getByRole("button", { name: "Save provider" })).toBeEnabled();
    });
  });

  it("library provider save sends exact payload without preexisting provider", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library", {
      library_show: () => fixtureLibraryShowOwnerNoProvider,
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Save provider" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByLabelText("Library provider"));
    await user.click(await screen.findByRole("option", { name: "Grok" }));
    await user.type(within(settingsView()).getByLabelText("Library provider model"), "grok-test");
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Save provider" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "library_set_provider");
      expect(call?.args).toMatchObject({ id: "grok", model: "grok-test" });
    });
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Clear provider" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "library_set_provider");
      expect(call?.args).toMatchObject({ clear: true });
    });
  });

  it("sync remote shows remote_note after save", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync");
    await waitFor(() => {
      expect(within(settingsView()).getByLabelText("Arbor remote")).toBeInTheDocument();
    });
    const remoteInput = within(settingsView()).getByLabelText("Arbor remote");
    await user.click(remoteInput);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.type(remoteInput, "git@new:repo.git");
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Save remote" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "sync_set_remote");
      expect(call?.args).toMatchObject({ url: "git@new:repo.git", root: FIXTURE_ROOT_FALL });
      expect(within(settingsView()).getByTestId("sync-remote-note")).toHaveTextContent(
        "Saved remote git@new:repo.git",
      );
    });
  });

  it("sync after commit merge keeps other knowledge fields", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync", {
      get_knowledge_settings: () => ({
        ...fixtureKnowledgeSettings,
        sync_after_commit: false,
        auto_generate: { flashcards: true, quiz: false },
      }),
    });
    await waitFor(() => {
      expect(
        within(settingsView()).getByRole("switch", { name: "Sync after each committed job" }),
      ).toBeInTheDocument();
    });
    await user.click(
      within(settingsView()).getByRole("switch", { name: "Sync after each committed job" }),
    );
    await waitFor(() => {
      const save = getMockIpcCalls().find((c) => c.cmd === "save_knowledge_settings");
      const ks = (save?.args as { settings?: typeof fixtureKnowledgeSettings })?.settings;
      expect(ks?.sync_after_commit).toBe(true);
      expect(ks?.auto_generate?.flashcards).toBe(true);
    });
  });

  it("conflict resolve theirs and use this text", async () => {
    useSyncUiStore.setState({ syncConflictOpen: true });
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/sync", {
      read_sync_conflict: () => fixtureSyncConflictSession,
    });
    const dialog = await screen.findByTestId("sync-conflict-dialog");
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Use theirs" })).toBeInTheDocument();
    });
    await user.click(within(dialog).getByRole("button", { name: "Use theirs" }));
    await waitFor(() => {
      expect(
        getMockIpcCalls().some(
          (c) => c.cmd === "sync_resolve" && (c.args as { side?: string })?.side === "theirs",
        ),
      ).toBe(true);
    });
    await user.click(within(dialog).getByText(/cell-biology\/course\.md/));
    await user.clear(within(dialog).getByLabelText("Resolved text"));
    await user.type(within(dialog).getByLabelText("Resolved text"), "Merged body");
    await user.click(within(dialog).getByRole("button", { name: "Use this text" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find(
        (c) => c.cmd === "sync_resolve" && (c.args as { side?: string })?.side === "edit",
      );
      expect(call?.args).toMatchObject({
        side: "edit",
        content: "Merged body",
      });
    });
  });

  it("conflict binary panel and continue reloads courses", async () => {
    useSyncUiStore.setState({ syncConflictOpen: true });
    const user = userEvent.setup();
    const { queryClient } = await renderAppAtRoute("/settings/sync", {
      read_sync_conflict: () => fixtureSyncConflictSession,
    });
    const dialog = await screen.findByTestId("sync-conflict-dialog");
    await waitFor(() => {
      expect(within(dialog).getByText("cell-biology/sources/lecture-a.pdf")).toBeInTheDocument();
    });
    await user.click(within(dialog).getByText("cell-biology/sources/lecture-a.pdf"));
    expect(within(dialog).getByTestId("sync-conflict-binary")).toBeInTheDocument();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(within(dialog).getByRole("button", { name: "Continue sync" }));
    await waitFor(() => {
      expect(useSyncUiStore.getState().syncConflictOpen).toBe(false);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.courses(FIXTURE_ROOT_FALL) });
    });
  });

  it("skill run sends exact payload when last course matches root", async () => {
    useUiStore.setState({
      lastCourse: { root: FIXTURE_ROOT_FALL, course: "cell-biology" },
    });
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue("/tmp/export");
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/skills", {
      get_settings: () => ({
        ...fixtureSettings,
        skill_grants: [
          {
            id: "demo-skill",
            commit: "abc111",
            permissions: ["read_course", "write_export_dir"],
          },
        ],
      }),
      skill_index: () => ({ packages: fixtureSkillPackages }),
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Browse index" }));
    const runButtons = within(settingsView()).getAllByRole("button", { name: "Run" });
    await user.click(runButtons[0]!);
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "skill_run");
      expect(call?.args).toEqual({
        root: FIXTURE_ROOT_FALL,
        id: "demo-skill",
        commit: "abc111",
        course: "cell-biology",
        exportDir: "/tmp/export",
        confirmed: true,
      });
    });
  });

  it("skill run without last course shows status and skips skill_run", async () => {
    useUiStore.setState({ lastCourse: null });
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/skills", {
      skill_index: () => ({ packages: fixtureSkillPackages }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Browse index" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Browse index" }));
    await waitFor(() => {
      expect(within(settingsView()).getAllByRole("button", { name: "Run" }).length).toBeGreaterThan(0);
    });
    clearMockIpcLog();
    const runButtons = within(settingsView()).getAllByRole("button", { name: "Run" });
    await user.click(runButtons[0]!);
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("skill-status")).toHaveTextContent(
        "Choose a course first",
      );
      expect(getMockIpcCalls().some((c) => c.cmd === "skill_run")).toBe(false);
    });
  });

  it("browse failure sets status and toast", async () => {
    const toastSpy = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/skills", {
      skill_index: () => {
        throw new Error("Index unreachable");
      },
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Browse index" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("skill-status")).toHaveTextContent("Index unreachable");
      expect(toastSpy).toHaveBeenCalled();
    });
  });

  it("viewer blocks skill run with write permissions", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/skills", {
      library_show: () => fixtureLibraryShowViewer,
      skill_index: () => ({ packages: fixtureSkillPackages }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Browse index" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Browse index" }));
    await waitFor(() => {
      expect(within(settingsView()).getByText("New permissions")).toBeInTheDocument();
    });
    const runNewPerms = within(settingsView())
      .getAllByRole("button", { name: "Run" })
      .at(-1)!;
    expect(runNewPerms).toBeDisabled();
    expect(getMockIpcCalls().some((c) => c.cmd === "skill_run")).toBe(false);
  });

  it("workers edit round trip and remove clears root worker_id", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/workers", {
      get_settings: () => ({
        ...fixtureSettings,
        workers: [
          {
            id: "w-edit001",
            label: "Edit me",
            host: "host.local",
            port: 22,
            user: "arbor",
            identity_file: null,
            worker_cmd: "cmd",
            remote_root: "/remote",
          },
        ],
        knowledge_roots: [
          {
            path: FIXTURE_ROOT_FALL,
            kind: "personal",
            name: "Fall",
            worker_id: "w-edit001",
          },
        ],
      }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Edit" }));
    await user.clear(within(settingsView()).getByLabelText("Worker label"));
    await user.type(within(settingsView()).getByLabelText("Worker label"), "Edited");
    await user.click(within(settingsView()).getByRole("button", { name: "Save worker" }));
    await waitFor(() => {
      const save = getMockIpcCalls().find((c) => c.cmd === "save_settings");
      const editedSettings = (save?.args as { settings?: { workers?: { label: string }[] } })
        ?.settings;
      expect(editedSettings?.workers?.[0]?.label).toBe("Edited");
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Remove" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => {
      const save = getMockIpcCalls().filter((c) => c.cmd === "save_settings").at(-1);
      const saved = (save?.args as {
        settings?: { workers?: unknown[]; knowledge_roots?: { path: string; worker_id?: string | null }[] };
      })?.settings;
      expect(saved?.workers?.length).toBe(0);
      expect(saved?.knowledge_roots?.find((e) => e.path === FIXTURE_ROOT_FALL)?.worker_id).toBeNull();
    });
  });

  it("per-root worker select persists worker_id", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/workers", {
      get_settings: () => ({
        ...fixtureSettings,
        workers: [
          {
            id: "w-root001",
            label: "Remote",
            host: "host.local",
            port: 22,
            user: null,
            identity_file: null,
            worker_cmd: "cmd",
            remote_root: "/remote",
          },
        ],
      }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByLabelText("Worker for Fall 2026")).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByLabelText("Worker for Fall 2026"));
    await user.click(await screen.findByRole("option", { name: "Remote" }));
    await waitFor(() => {
      const save = getMockIpcCalls().find((c) => c.cmd === "save_settings");
      const rootSettings = (save?.args as {
        settings?: { knowledge_roots?: { path: string; worker_id?: string | null }[] };
      })?.settings;
      expect(rootSettings?.knowledge_roots?.find((e) => e.path === FIXTURE_ROOT_FALL)?.worker_id).toBe(
        "w-root001",
      );
    });
  });

  it("test_worker_connection receives snake_case worker payload", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/workers");
    await user.type(within(settingsView()).getByLabelText("Worker label"), "GPU");
    await user.type(within(settingsView()).getByLabelText("Worker host"), "gpu.local");
    await user.type(within(settingsView()).getByLabelText("Worker user"), "flow");
    await user.type(within(settingsView()).getByLabelText("Worker command"), "cmd");
    await user.type(within(settingsView()).getByLabelText("Remote root"), "/data");
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "test_worker_connection");
      const worker = (call?.args as { worker?: Record<string, unknown> })?.worker;
      expect(worker).toMatchObject({
        label: "GPU",
        host: "gpu.local",
        user: "flow",
        worker_cmd: "cmd",
        remote_root: "/data",
      });
    });
  });

  it("join library dialog sends join_library payload", async () => {
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue("/mock/knowledge/joined");
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library");
    await waitFor(() => {
      expect(within(settingsView()).getByRole("button", { name: "Join a library" })).toBeInTheDocument();
    });
    await user.click(within(settingsView()).getByRole("button", { name: "Join a library" }));
    await user.type(await screen.findByLabelText("Library URL"), "git@host:repo.git");
    await user.click(screen.getByRole("button", { name: "Choose folder…" }));
    await user.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => {
      const call = getMockIpcCalls().find((c) => c.cmd === "join_library");
      expect(call?.args).toMatchObject({
        url: "git@host:repo.git",
        dest: "/mock/knowledge/joined",
      });
    });
  });
});
