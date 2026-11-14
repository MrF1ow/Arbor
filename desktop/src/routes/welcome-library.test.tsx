import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { UpdateReviewDialog } from "~/components/app/update-review-dialog";
import { DESKTOP_ONLY_WELCOME_COPY } from "~/domain/tauri";
import type { Settings } from "~/domain/types";
import * as ipcModule from "~/lib/ipc";
import * as tauriModule from "~/domain/tauri";
import {
  fixturePendingSources,
  fixtureSettings,
} from "~/test/fixtures/data";
import * as eventsModule from "~/lib/events";
import * as authRefreshModule from "~/lib/auth-refresh";
import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { clearMockIpcLog, getMockIpcCalls, getMockIpcLog } from "~/test/mock-handlers";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { installMockIpc } from "~/test/mock-ipc";
import { renderAppAtRoute, renderWithProviders } from "~/test/render";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";

const NEW_ROOT = "/mock/knowledge/new-library";

/** Commands that create or retarget a Knowledge folder. Shell reads are not in this set. */
const KNOWLEDGE_FOLDER_WRITES = [
  "init_knowledge_repo",
  "save_settings",
  "init_arbor_db",
  "start_folder_watch",
] as const;

function knowledgeFolderWrites(log: readonly string[]): string[] {
  return log.filter((cmd) =>
    (KNOWLEDGE_FOLDER_WRITES as readonly string[]).includes(cmd),
  );
}

describe("welcome and library flows (PR 6)", () => {
  beforeEach(() => {
    resetAuthRefreshForTests();
    clearMockIpcLog();
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "light",
      sidebarOpen: true,
      sidebarTouched: true,
      logOpen: false,
      logHeight: 200,
      notesIndexOpen: true,
      lastCourse: null,
    });
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
    });
    useUpdatePlanStore.setState({ pending: null, open: false, trigger: "manual" });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("renders brand marks with empty alt and theme swap classes in the top bar", async () => {
    const { router } = await renderAppAtRoute("/welcome", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/welcome");
    });
    expect(document.querySelectorAll('img[alt=""]').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll('img.dark\\:hidden[alt=""]').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('img.hidden.dark\\:block[alt=""]').length).toBeGreaterThanOrEqual(1);
  });

  it("First run lists the three steps, and + Add class waits for a folder", async () => {
    await renderAppAtRoute("/welcome", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    expect(await screen.findByRole("heading", { name: "Welcome to Arbor" })).toBeInTheDocument();
    for (const step of ["Choose a Knowledge folder", "Add a class and its lectures", "Update knowledge"]) {
      expect(screen.getByRole("heading", { name: step })).toBeInTheDocument();
    }
    expect(screen.getByText("Needs a signed-in provider")).toBeInTheDocument();
    expect(within(screen.getByTestId("first-run")).getByRole("button", { name: "+ Add class" })).toBeDisabled();
  });

  it("Join a shared library opens the join dialog from First run, and a join reaches the library", async () => {
    const user = userEvent.setup();
    const JOINED = "/mock/knowledge/joined-lib";
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue(JOINED);
    let settings: Settings = {
      ...fixtureSettings,
      knowledge_root: null,
      active_root: null,
      knowledge_roots: [],
    };
    const { router } = await renderAppAtRoute("/", {
      get_settings: () => settings,
      save_settings: (args) => {
        settings = (args as { settings: Settings }).settings;
        return null;
      },
    });
    await user.click(await screen.findByRole("button", { name: "Join a shared library" }));
    // It stays on First run: the join dialog opens in place instead of a settings page with no Join button.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Join a library")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");

    await user.type(within(dialog).getByRole("textbox", { name: "Library URL" }), "git@host:team/notes.git");
    await user.click(within(dialog).getByRole("button", { name: "Choose folder…" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("textbox", { name: "Folder" })).toHaveValue(JOINED);
    });
    await user.click(within(dialog).getByRole("button", { name: "Join" }));

    await waitFor(() => {
      expect(getMockIpcLog()).toContain("join_library");
    });
    const joinCall = getMockIpcCalls().find((c) => c.cmd === "join_library");
    expect(joinCall?.args).toMatchObject({ url: "git@host:team/notes.git", dest: JOINED });
    await waitFor(() => {
      expect(settings.knowledge_roots).toEqual([{ path: JOINED, kind: "shared", name: "Joined library" }]);
    });
    // The library now exists, so / is Today and the dialog is gone.
    expect(await screen.findByTestId("today-page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("first-run")).not.toBeInTheDocument();
  });

  it("shows one Toggle Sidebar button, the top bar's, when the sidebar is closed", async () => {
    useUiStore.setState({ sidebarOpen: false, sidebarTouched: true });
    await renderAppAtRoute("/welcome");
    await screen.findByTestId("welcome-choose-folder");
    expect(screen.getAllByRole("button", { name: "Toggle Sidebar" })).toHaveLength(1);
  });

  it("choose folder runs init_knowledge_repo, save_settings, init_arbor_db, start_folder_watch in order", async () => {
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue(NEW_ROOT);
    clearMockIpcLog();
    const { router } = await renderAppAtRoute("/welcome", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
      list_courses: (args) => {
        if (String((args as { root?: string }).root) === NEW_ROOT) {
          return ["cell-biology"];
        }
        return [];
      },
    });
    const user = userEvent.setup();
    const chooseBtn = await screen.findByTestId("welcome-choose-folder");
    expect(chooseBtn).toBeEnabled();
    await user.click(chooseBtn);
    await waitFor(() => {
      const log = getMockIpcLog();
      const repoIdx = log.indexOf("init_knowledge_repo");
      const saveIdx = log.indexOf("save_settings");
      const dbIdx = log.indexOf("init_arbor_db");
      const watchIdx = log.indexOf("start_folder_watch");
      expect(repoIdx).toBeGreaterThanOrEqual(0);
      expect(saveIdx).toBeGreaterThan(repoIdx);
      expect(dbIdx).toBeGreaterThan(saveIdx);
      expect(watchIdx).toBeGreaterThan(dbIdx);
      const repoCall = getMockIpcCalls().find((c) => c.cmd === "init_knowledge_repo");
      expect((repoCall?.args as { path?: string })?.path).toBe(NEW_ROOT);
      const saveCall = getMockIpcCalls().find((c) => c.cmd === "save_settings");
      const saved = (saveCall?.args as { settings?: Record<string, unknown> })?.settings;
      expect(saved?.active_root).toBe(NEW_ROOT);
      expect(saved?.knowledge_root).toBe(NEW_ROOT);
      expect(
        (saved?.knowledge_roots as { path: string }[])?.some((e) => e.path === NEW_ROOT),
      ).toBe(true);
      const dbCall = getMockIpcCalls().find((c) => c.cmd === "init_arbor_db");
      expect((dbCall?.args as { root?: string })?.root).toBe(NEW_ROOT);
      const watchCall = getMockIpcCalls().find((c) => c.cmd === "start_folder_watch");
      expect((watchCall?.args as { root?: string })?.root).toBe(NEW_ROOT);
      expect(router.state.location.pathname).toContain("/course/cell-biology/overview");
    });
  });

  it("does not duplicate an existing knowledge root entry", async () => {
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue(FIXTURE_ROOT_FALL);
    clearMockIpcLog();
    await renderAppAtRoute("/welcome");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("welcome-choose-folder"));
    await waitFor(() => {
      const saveCall = getMockIpcCalls().find((c) => c.cmd === "save_settings");
      const roots = (saveCall?.args as { settings?: { knowledge_roots?: { path: string }[] } })
        ?.settings?.knowledge_roots;
      expect(roots?.filter((e) => e.path === FIXTURE_ROOT_FALL)).toHaveLength(1);
    });
  });

  it("cancelled folder picker does not write a knowledge root", async () => {
    const openDialog = vi.spyOn(ipcModule, "openDialog").mockResolvedValue(null);
    await renderAppAtRoute("/welcome", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    await screen.findByTestId("welcome-choose-folder");
    clearMockIpcLog();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("welcome-choose-folder"));
    await waitFor(() => {
      expect(openDialog).toHaveBeenCalled();
    });
    // The click handler does not return its promise. Let the dialog resolution
    // finish, then assert the folder writes. Shell reads such as check_auth may
    // still arrive; they are not part of this contract.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(knowledgeFolderWrites(getMockIpcLog())).toEqual([]);
  });

  it("does not probe auth until settings name a provider", async () => {
    let releaseSettings: (value: typeof fixtureSettings) => void = () => {};
    const pendingSettings = new Promise<typeof fixtureSettings>((resolve) => {
      releaseSettings = resolve;
    });
    await renderAppAtRoute("/welcome", {
      get_settings: () => pendingSettings,
    });
    await screen.findByTestId("welcome-choose-folder");
    expect(getMockIpcLog().filter((cmd) => cmd === "check_auth")).toEqual([]);
    expect(getMockIpcLog().filter((cmd) => cmd === "list_models")).toEqual([]);

    releaseSettings(fixtureSettings);
    await waitFor(() => {
      expect(getMockIpcCalls().some((call) => call.cmd === "check_auth")).toBe(true);
    });
    const providers = getMockIpcCalls()
      .filter((call) => call.cmd === "check_auth")
      .map((call) => (call.args as { provider?: string } | undefined)?.provider);
    expect(providers.length).toBeGreaterThan(0);
    expect(new Set(providers)).toEqual(new Set(["grok"]));
  });

  it("shows the add-class form in step 2 when the new root has zero courses", async () => {
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue(NEW_ROOT);
    await renderAppAtRoute("/welcome", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
      list_courses: () => [],
    });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("welcome-choose-folder"));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Class name" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Add a class and its lectures" })).toBeInTheDocument();
  });

  it("creates the first class from step 2 and opens its overview", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute(`/welcome?addClass=true&root=${encodeURIComponent(NEW_ROOT)}`, {
      list_courses: () => [],
      create_course: () => "biology-101",
    });
    await user.type(await screen.findByRole("textbox", { name: "Class name" }), "Biology 101");
    await user.click(screen.getByRole("button", { name: "Create class" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/biology-101/overview");
    });
  });

  it("desktop-only welcome copy and no ipc when tauri is unavailable", async () => {
    vi.spyOn(tauriModule, "canUseDesktopIpc").mockReturnValue(false);
    clearMockIpcLog();
    await renderAppAtRoute("/welcome");
    clearMockIpcLog();
    expect(screen.getByText(DESKTOP_ONLY_WELCOME_COPY)).toBeInTheDocument();
    expect(screen.getByTestId("welcome-choose-folder")).toBeDisabled();
    expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Desktop app required");
    expect(getMockIpcLog()).toEqual([]);
  });

  it("groups two workspace roots and switches root before navigating", async () => {
    const user = userEvent.setup();
    clearMockIpcLog();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fall 2026/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Shared · Study group/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Collab Notes/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Collab Notes/i }));
    await waitFor(() => {
      const log = getMockIpcLog();
      const saveIdx = log.lastIndexOf("save_settings");
      const watchIdx = log.lastIndexOf("start_folder_watch");
      expect(saveIdx).toBeGreaterThanOrEqual(0);
      expect(watchIdx).toBeGreaterThan(saveIdx);
      expect(router.state.location.pathname).toContain("/course/collab-notes/overview");
    });
  });
});

describe("update review dialog", () => {
  beforeEach(() => {
    installMockIpc();
    useUpdatePlanStore.setState({
      pending: fixturePendingSources,
      open: true,
      trigger: "manual",
    });
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      lines: [],
      unread: 0,
    });
    useUiStore.setState({ logOpen: false });
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
    useUpdatePlanStore.setState({ pending: null, open: false, trigger: "manual" });
  });

  it("renders rows with prefilled ranges and alignment notes", async () => {
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("lecture-a.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("cell-biology/sources")).toHaveLength(3);
    expect(screen.getByDisplayValue("151-300")).toBeInTheDocument();
    expect(screen.getByText(/Alignment is uncertain/i)).toBeInTheDocument();
    expect(screen.getByText(/Pages were removed/i)).toBeInTheDocument();
  });

  it("invalid range shows legacy error and disables Confirm", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    const rangeInput = await screen.findByDisplayValue("151-300");
    await user.clear(rangeInput);
    await user.type(rangeInput, "999");
    await user.tab();
    await waitFor(() => {
      expect(screen.getByText("Range 999-999 is outside 1-300.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("Confirm re-enables after fixing an invalid range without blur", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    const rangeInput = await screen.findByDisplayValue("151-300");
    await user.clear(rangeInput);
    await user.type(rangeInput, "999");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
    await user.clear(rangeInput);
    await user.type(rangeInput, "151-300");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    });
  });

  it("Confirm sends start_update with watch trigger when store trigger is watch", async () => {
    useUpdatePlanStore.setState({ trigger: "watch" });
    const user = userEvent.setup();
    clearMockIpcLog();
    renderWithProviders(<UpdateReviewDialog />, {
      minimal: true,
      fixtures: {
        start_update: (args) => {
          expect((args as { trigger?: string }).trigger).toBe("watch");
          return "mock-job-watch";
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_update"));
  });

  it("Confirm sends start_update with selections and closes", async () => {
    const user = userEvent.setup();
    clearMockIpcLog();
    renderWithProviders(<UpdateReviewDialog />, {
      minimal: true,
      fixtures: {
        start_update: (args) => {
          const selections = (args as { selections?: unknown }).selections;
          expect(selections).toEqual([
            { path: fixturePendingSources[0].path, ranges: [[151, 300]] },
            { path: fixturePendingSources[1].path, ranges: null },
            { path: fixturePendingSources[2].path, ranges: null },
          ]);
          return "mock-job-from-review";
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(getMockIpcLog()).toContain("start_update");
      expect(useUpdatePlanStore.getState().open).toBe(false);
    });
  });

  it("start failure keeps the dialog open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpdateReviewDialog />, {
      minimal: true,
      fixtures: {
        start_update: () => {
          throw new Error("boom");
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(useJobStore.getState().lines.some((l) => l.includes("Update failed to start: boom"))).toBe(
        true,
      );
      expect(useUpdatePlanStore.getState().open).toBe(true);
    });
  });

  it("signed-out Confirm logs auth message and keeps dialog open", async () => {
    resetAuthRefreshForTests();
    vi.spyOn(authRefreshModule, "fetchAuthStatus").mockResolvedValue({
      authenticated: false,
      reason: "signed out",
      docs_url: "",
    });
    clearMockIpcLog();
    const user = userEvent.setup();
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(useJobStore.getState().lines.some((l) => l.includes("not authenticated"))).toBe(true);
      expect(getMockIpcLog()).not.toContain("start_update");
      expect(useUpdatePlanStore.getState().open).toBe(true);
    });
  });

  it("Escape cancels once in the job log", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    const rangeInput = await screen.findByDisplayValue("151-300");
    await user.click(rangeInput);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(useUpdatePlanStore.getState().open).toBe(false);
      expect(
        useJobStore.getState().lines.filter((l) => l.includes("Update cancelled")).length,
      ).toBe(1);
    });
  });

  it("Enter moves focus to the next range field", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    const first = await screen.findByDisplayValue("151-300");
    await user.click(first);
    await user.keyboard("{Enter}");
    const inputs = screen.getAllByPlaceholderText("all");
    expect(document.activeElement).toBe(inputs[1]);
  });

  it("Cancel clears the store", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(useUpdatePlanStore.getState().open).toBe(false);
      expect(useUpdatePlanStore.getState().pending).toBeNull();
    });
  });

  it("does not open the log drawer while reviewing", async () => {
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(useUiStore.getState().logOpen).toBe(false);
  });
});

describe("import feedback", () => {
  beforeEach(() => {
    useUpdatePlanStore.setState({ pending: null, open: false, trigger: "manual" });
    useUiStore.setState({ logOpen: false });
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("import shows toast and opens review when plan has pending files", async () => {
    const suppressSpy = vi.spyOn(eventsModule, "suppressWatch");
    const openDialogSpy = vi
      .spyOn(ipcModule, "openDialog")
      .mockResolvedValue(["/tmp/new.pdf"]);
    const user = userEvent.setup();
    clearMockIpcLog();
    await renderAppAtRoute("/course/cell-biology/notes", {
      list_digests: () => [],
      plan_update: () => ({ pending: fixturePendingSources.slice(0, 1) }),
      get_knowledge_settings: () => ({
        delete_sources_after_digest: false,
        auto_update: false,
        auto_embed: false,
        watch_enabled: false,
        auto_generate: { flashcards: false, quiz: false },
        sync_after_commit: false,
      }),
    });
    const addButtons = await screen.findAllByRole("button", { name: /Add files/i });
    await user.click(addButtons[addButtons.length - 1]!);
    await waitFor(() => {
      expect(openDialogSpy).toHaveBeenCalled();
      expect(suppressSpy).toHaveBeenCalledWith(5000);
      expect(getMockIpcLog()).toContain("import_sources");
      expect(useUpdatePlanStore.getState().open).toBe(true);
    });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Added 1 file\(s\)/);
    });
  });

  it("Add files shows a busy spinner while import_sources runs", async () => {
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue(["/tmp/new.pdf"]);
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes", {
      list_digests: () => [],
      import_sources: () =>
        new Promise<string[]>((resolve) => {
          setTimeout(() => resolve(["/mock/knowledge/fall-2026/cell-biology/lecture.pdf"]), 400);
        }),
      plan_update: () => ({ pending: [] }),
      get_knowledge_settings: () => ({
        delete_sources_after_digest: false,
        auto_update: false,
        auto_embed: false,
        watch_enabled: false,
        auto_generate: { flashcards: false, quiz: false },
        sync_after_commit: false,
      }),
    });
    const addButtons = await screen.findAllByRole("button", { name: /Add files/i });
    const addBtn = addButtons[addButtons.length - 1]!;
    await user.click(addBtn);
    await waitFor(() => {
      expect(addBtn.querySelector(".animate-spin")).toBeTruthy();
    });
  });

  it("empty plan after import logs nothing to process and skips dialog", async () => {
    vi.spyOn(ipcModule, "openDialog").mockResolvedValue(["/tmp/new.pdf"]);
    const user = userEvent.setup();
    clearMockIpcLog();
    await renderAppAtRoute("/course/cell-biology/notes", {
      list_digests: () => [],
      plan_update: () => ({ pending: [] }),
      get_knowledge_settings: () => ({
        delete_sources_after_digest: false,
        auto_update: false,
        auto_embed: false,
        watch_enabled: false,
        auto_generate: { flashcards: false, quiz: false },
        sync_after_commit: false,
      }),
    });
    const addButtons = await screen.findAllByRole("button", { name: /Add files/i });
    await user.click(addButtons[addButtons.length - 1]!);
    await waitFor(() => {
      expect(getMockIpcLog()).toContain("import_sources");
      expect(useJobStore.getState().lines.some((l) => l.includes("Nothing to process"))).toBe(true);
      expect(useUpdatePlanStore.getState().open).toBe(false);
    });
  });
});
