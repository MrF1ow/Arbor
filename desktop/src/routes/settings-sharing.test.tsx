import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ROOT_FALL, fixtureSettings } from "~/test/fixtures/data";
import {
  fixtureLibraryShowOwner,
  fixtureLibraryShowViewer,
  fixtureSkillPackages,
  fixtureSyncConflictSession,
} from "~/test/fixtures/settings-sharing";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { clearTauriMocks } from "~/test/mock-ipc";
import * as ipcModule from "~/lib/ipc";
import { resetSaveSettingsChainForTests } from "~/lib/queries/settings";
import { useSyncUiStore } from "~/stores/sync-ui-store";
import { renderAppAtRoute } from "~/test/render";

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
