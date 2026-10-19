import { emit } from "@tauri-apps/api/event";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { FIXTURE_ROOT_FALL, fixtureSettings } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";
import { renderAppAtRoute } from "~/test/render";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";

async function waitForCourseOverview() {
  await waitFor(() => {
    expect(screen.getAllByText("Overview arrives in PR 7.").length).toBeGreaterThan(0);
  });
}

describe("app shell", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: false,
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
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("redirects / to last course notes when lastCourse is set", async () => {
    useUiStore.setState({
      lastCourse: { root: FIXTURE_ROOT_FALL, course: "organic-chemistry-ii" },
    });
    const { router } = await renderAppAtRoute("/");
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/organic-chemistry-ii/notes");
    });
  });

  it("redirects / to welcome when there is no knowledge root", async () => {
    const { router } = await renderAppAtRoute("/", {
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
  });

  it("navigates to course notes and sets lastCourse from the sidebar", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForCourseOverview();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Organic Chemistry/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Organic Chemistry/i }));
    await waitFor(() => {
      expect(useUiStore.getState().lastCourse).toEqual({
        root: FIXTURE_ROOT_FALL,
        course: "organic-chemistry-ii",
      });
    });
  });

  it("switches active root before navigating to a course in another library", async () => {
    const user = userEvent.setup();
    clearMockIpcLog();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForCourseOverview();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Collab Notes/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Collab Notes/i }));
    await waitFor(() => {
      expect(getMockIpcLog()).toContain("save_settings");
      expect(getMockIpcLog()).toContain("start_folder_watch");
      expect(router.state.location.pathname).toContain("/course/collab-notes/notes");
    });
  });

  it("toggles sidebar from the hide control and shows header trigger when hidden", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForCourseOverview();
    await user.click(screen.getByRole("button", { name: /Hide sidebar/i }));
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Toggle Sidebar/i })).toBeInTheDocument();
    });
  });

  it("keeps log closed on progress events but shows unread; Mod+backtick opens and clears unread", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForCourseOverview();
    for (let i = 0; i < 3; i += 1) {
      await emit("arbor://progress", { line: `plain line ${i}` });
    }
    await waitFor(() => expect(useJobStore.getState().unread).toBeGreaterThanOrEqual(3));
    expect(useUiStore.getState().logOpen).toBe(false);
    await user.keyboard("{Control>}`{/Control}");
    await waitFor(() => expect(useUiStore.getState().logOpen).toBe(true));
    expect(useJobStore.getState().unread).toBe(0);
  });

  it("shows a failure toast without opening the log; View log opens the drawer", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForCourseOverview();
    useJobStore.setState({ status: "running" });
    useJobStore.setState({ status: "failed" });
    await waitFor(() => expect(screen.getAllByText(/Last job failed/i).length).toBeGreaterThan(0));
    expect(useUiStore.getState().logOpen).toBe(false);
    const viewLogButtons = screen.getAllByRole("button", { name: /View log/i });
    await user.click(viewLogButtons[viewLogButtons.length - 1]!);
    await waitFor(() => expect(useUiStore.getState().logOpen).toBe(true));
  });

  it("reflects flashcards route from Mod+2", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForCourseOverview();
    await user.keyboard("{Control>}2{/Control}");
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/cell-biology/flashcards");
    });
  });

  it("disables action bar writes for viewer libraries", async () => {
    await renderAppAtRoute("/course/cell-biology/notes", {
      library_show: () => ({
        present: true,
        name: "Shared",
        created_by: "a@example.com",
        members: [],
        provider: null,
        role: "viewer",
      }),
    });
    await waitForCourseOverview();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Update knowledge/i })).toBeDisabled();
    });
  });

  it("validates add class then creates course and navigates to overview", async () => {
    const user = userEvent.setup();
    clearMockIpcLog();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForCourseOverview();
    await user.click(screen.getByRole("button", { name: /Add class/i }));
    await user.click(screen.getByRole("button", { name: /Create class/i }));
    expect(screen.getByText(/Enter a class name/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Class name/i), "New Seminar");
    await user.click(screen.getByRole("button", { name: /Create class/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("create_course"));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/new-seminar/notes");
    });
  });
});
