import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { UpdateReviewDialog } from "~/components/app/update-review-dialog";
import { DESKTOP_ONLY_WELCOME_COPY } from "~/domain/tauri";
import * as ipcModule from "~/lib/ipc";
import * as tauriModule from "~/domain/tauri";
import {
  fixturePendingSources,
  fixtureSettings,
} from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";
import { renderAppAtRoute, renderWithProviders } from "~/test/render";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";

const NEW_ROOT = "/mock/knowledge/new-library";

describe("welcome and library flows (PR 6)", () => {
  beforeEach(() => {
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
      lines: [],
      unread: 0,
    });
    useUpdatePlanStore.setState({ pending: null, open: false, trigger: "manual" });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    vi.restoreAllMocks();
  });

  it("renders brand marks with empty alt in sidebar and welcome", async () => {
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
    const imgs = document.querySelectorAll('img[alt=""]');
    expect(imgs.length).toBeGreaterThanOrEqual(2);
  });

  it("choose folder runs init_knowledge_repo, save_settings, init_arbor_db then navigates", async () => {
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
      expect(repoIdx).toBeGreaterThanOrEqual(0);
      expect(saveIdx).toBeGreaterThan(repoIdx);
      expect(dbIdx).toBeGreaterThan(saveIdx);
      expect(router.state.location.pathname).toContain("/course/cell-biology/notes");
    });
  });

  it("shows add-class step when the new root has zero courses", async () => {
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
      expect(screen.getByRole("heading", { name: /Add your first class/i })).toBeInTheDocument();
    });
  });

  it("desktop-only welcome copy and no ipc when tauri is unavailable", async () => {
    vi.spyOn(tauriModule, "canUseDesktopIpc").mockReturnValue(false);
    clearMockIpcLog();
    await renderAppAtRoute("/welcome");
    clearMockIpcLog();
    expect(screen.getByText(DESKTOP_ONLY_WELCOME_COPY)).toBeInTheDocument();
    expect(screen.getByTestId("welcome-choose-folder")).toBeDisabled();
    expect(screen.getByText("Desktop app required")).toBeInTheDocument();
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
      expect(router.state.location.pathname).toContain("/course/collab-notes/notes");
    });
  });
});

describe("update review dialog", () => {
  beforeEach(() => {
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
    clearMocks();
    vi.restoreAllMocks();
    useUpdatePlanStore.setState({ pending: null, open: false, trigger: "manual" });
  });

  it("renders rows with prefilled ranges and alignment notes", async () => {
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
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
      expect(useJobStore.getState().lines.some((l) => l.includes("Update failed to start"))).toBe(
        true,
      );
      expect(useUpdatePlanStore.getState().open).toBe(true);
    });
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
    clearMocks();
    vi.restoreAllMocks();
  });

  it("import shows toast and opens review when plan has pending files", async () => {
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
      expect(getMockIpcLog()).toContain("import_sources");
      expect(useUpdatePlanStore.getState().open).toBe(true);
    });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Added 1 file\(s\)/);
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
