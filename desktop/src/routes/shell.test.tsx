import { emit } from "@tauri-apps/api/event";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcCalls, getMockIpcLog } from "~/test/mock-handlers";
import { renderAppAtRoute } from "~/test/render";
import type { TodayPayload, TodayCourseRow } from "~/domain/today";
import { resetJobStoreForRootSwitch, useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";

function todayRow(course: string, due: number): TodayCourseRow {
  return {
    course,
    digest_count: 3,
    due_ids: Array.from({ length: due }, (_, i) => `${course}-${i}`),
    deck_count: 10,
    mastered: 4,
    mastery: 0.4,
    exam_date: null,
    days_to_exam: null,
    plan: null,
  };
}

function todayPayload(rows: TodayCourseRow[]): TodayPayload {
  return {
    courses: rows,
    weak_topics: [],
    quiz_accuracy: { this_week: { correct: 0, total: 0 }, last_week: { correct: 0, total: 0 } },
    next_exam: null,
  };
}

/** Fall 2026 has 14 + 5 cards due, the shared library 3: 22 in all. */
const TWO_LIBRARIES_TODAY = (args: unknown) => {
  const root = (args as { root?: string }).root;
  return root === FIXTURE_ROOT_SHARED
    ? todayPayload([todayRow("collab-notes", 3)])
    : todayPayload([todayRow("cell-biology", 14), todayRow("organic-chemistry-ii", 5)]);
};

async function openLibraryMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("library-status-pill"));
  return screen.findByRole("menu");
}

async function waitForCourseOverview() {
  await waitFor(() => {
    expect(screen.getAllByText("Course overview").length).toBeGreaterThan(0);
  });
}

describe("app shell", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: true,
      logOpen: false,
      logHeight: 200,
      lastCourse: null,
    });
    useUpdatePlanStore.getState().close();
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      lastFinishedJobId: null,
      lastFinishedStatus: null,
      status: "idle",
      step: null,
      label: null,
      root: null,
      progress: null,
      lines: [],
      unread: 0,
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("opens Today at / instead of redirecting to the last class, with the Today row current", async () => {
    useUiStore.setState({
      lastCourse: { root: FIXTURE_ROOT_FALL, course: "organic-chemistry-ii" },
    });
    const { router } = await renderAppAtRoute("/");
    expect(await screen.findByTestId("today-page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    const sidebar = await screen.findByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveAttribute("aria-current", "page");
  });

  it("shows First run at / when there is no knowledge root, and keeps the Today row current", async () => {
    const { router } = await renderAppAtRoute("/", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    expect(await screen.findByRole("heading", { name: "Welcome to Arbor" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    const sidebar = await screen.findByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveAttribute("aria-current", "page");
  });

  it("lands on Today when a library header is clicked inside a class, instead of Class not found", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    const sidebar = await screen.findByRole("complementary");
    // "Class not found" can flash between the library switch and the navigation, so watch for it
    // from the click on instead of checking once after Today has rendered.
    let sawClassNotFound = false;
    const observer = new MutationObserver(() => {
      sawClassNotFound ||= screen.queryByText("Class not found") !== null;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await user.click(await within(sidebar).findByRole("button", { name: /Shared · Study group/ }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
      expect(await screen.findByTestId("today-page")).toBeInTheDocument();
    } finally {
      observer.disconnect();
    }
    expect(sawClassNotFound).toBe(false);
    expect(screen.queryByText("Class not found")).not.toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveAttribute("aria-current", "page");
  });

  it("a class link into a library that is not active (browser Back after a library switch) switches to it and shows the class", async () => {
    const savePayloads: { settings: { active_root: string } }[] = [];
    // Settings that keep what was saved, so the library switch really changes the active library.
    let current = fixtureSettings;
    const { router } = await renderAppAtRoute("/course/collab-notes/overview", {
      get_settings: () => current,
      save_settings: (args) => {
        savePayloads.push(args as { settings: { active_root: string } });
        current = (args as { settings: typeof fixtureSettings }).settings;
        return null;
      },
    });
    await waitFor(() => {
      expect(savePayloads.at(-1)?.settings.active_root).toBe(FIXTURE_ROOT_SHARED);
    });
    // The class's own workspace is on screen (the shared library's class has no digests yet).
    expect(await screen.findByText("No digests yet")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/course/collab-notes/overview");
    expect(screen.queryByText("Class not found")).not.toBeInTheDocument();
  });

  it("a class that is in none of the libraries says so and links to Today, not to first-run", async () => {
    await renderAppAtRoute("/course/no-such-class/overview");
    expect(await screen.findByText("Class not found")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Back to Today" });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Back to welcome" })).not.toBeInTheDocument();
  });

  it("stays where it is when the header of the active library is clicked", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    const sidebar = await screen.findByRole("complementary");
    await user.click(await within(sidebar).findByRole("button", { name: /Fall 2026/ }));
    expect(router.state.location.pathname).toBe("/course/cell-biology/overview");
  });

  it("opens a class on its overview and sets lastCourse from the sidebar", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview");
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
    const savePayloads: unknown[] = [];
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", {
      save_settings: (args) => {
        savePayloads.push(args);
        return null;
      },
    });
    await waitForCourseOverview();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Collab Notes/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Collab Notes/i }));
    await waitFor(() => {
      const log = getMockIpcLog();
      const saveIdx = log.indexOf("save_settings");
      const watchIdx = log.indexOf("start_folder_watch");
      expect(saveIdx).toBeGreaterThanOrEqual(0);
      expect(watchIdx).toBeGreaterThan(saveIdx);
      expect(savePayloads.length).toBeGreaterThan(0);
      const settings = (savePayloads[0] as { settings: { active_root: string } }).settings;
      expect(settings.active_root).toBe(FIXTURE_ROOT_SHARED);
      expect(router.state.location.pathname).toContain("/course/collab-notes/overview");
    });
  });

  it("Mod+B flips sidebarOpen", async () => {
    const user = userEvent.setup();
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true });
    await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    await user.keyboard("{Control>}b{/Control}");
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it("keeps sidebar open when selecting a course at desktop width", async () => {
    const user = userEvent.setup();
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true });
    await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Organic Chemistry/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Organic Chemistry/i }));
    await waitFor(() => {
      expect(useUiStore.getState().sidebarOpen).toBe(true);
    });
  });

  it("keeps log closed on progress events but shows unread; Mod+backtick opens and clears unread", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    for (let i = 0; i < 3; i += 1) {
      await emit("arbor://progress", { line: `plain line ${i}` });
    }
    await waitFor(() => expect(useJobStore.getState().unread).toBeGreaterThanOrEqual(3));
    expect(useUiStore.getState().logOpen).toBe(false);
    expect(screen.getByTestId("log-unread-dot")).toBeInTheDocument();
    await user.keyboard("{Control>}`{/Control}");
    await waitFor(() => expect(useUiStore.getState().logOpen).toBe(true));
    expect(useJobStore.getState().unread).toBe(0);
  });

  it("shows a failure toast without opening the log; View log opens the drawer", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview");
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
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    await user.keyboard("{Control>}2{/Control}");
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/cell-biology/practice/cards");
    });
  });

  it("ignores Mod+2 while an input is focused", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add class/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Add class/i }));
    const input = await screen.findByLabelText(/Class name/i);
    await user.click(input);
    await user.keyboard("{Control>}2{/Control}");
    expect(router.state.location.pathname).toContain("/course/cell-biology/overview");
  });

  it("validates add class then creates course and navigates to overview", async () => {
    const user = userEvent.setup();
    clearMockIpcLog();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    await user.click(screen.getByRole("button", { name: /Add class/i }));
    await user.click(screen.getByRole("button", { name: /Create class/i }));
    expect(screen.getByText(/Enter a class name/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Class name/i), "New Seminar");
    await user.click(screen.getByRole("button", { name: /Create class/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("create_course"));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/new-seminar/overview");
    });
  });

  it("renders /dev/ui without the app sidebar", async () => {
    await renderAppAtRoute("/dev/ui");
    expect(screen.queryByRole("button", { name: /Hide sidebar/i })).not.toBeInTheDocument();
  });

  it("does not auto-open the mobile sidebar sheet when sidebarOpen is persisted true", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(700);
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true });
    await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the mobile sidebar overlay when the viewport widens past the mobile breakpoint", async () => {
    type MediaListener = (event: MediaQueryListEvent) => void;
    const listeners: MediaListener[] = [];
    let mobile = true;
    vi.spyOn(window, "innerWidth", "get").mockImplementation(() => (mobile ? 700 : 1280));
    window.matchMedia = vi.fn((query: string) => {
      const matches = query === "(max-width: 767px)" ? mobile : false;
      return {
        matches,
        media: query,
        addEventListener: (_type: string, listener: MediaListener) => {
          listeners.push(listener);
        },
        removeEventListener: (_type: string, listener: MediaListener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        },
        dispatchEvent: () => true,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
      } as MediaQueryList;
    });
    const setMobile = (next: boolean) => {
      mobile = next;
      for (const listener of [...listeners]) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    };

    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true });
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview");
    await waitForCourseOverview();
    await user.click(screen.getByRole("button", { name: /Toggle Sidebar/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    setMobile(false);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    setMobile(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  describe("top bar", () => {
    it("opens the search palette from the search field", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: /Search notes, concepts, and cards in every class/i }),
      );
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("has the Arbor mark and a Settings button that opens Settings", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      const bar = screen.getByRole("banner");
      expect(within(bar).getByText("Arbor")).toBeInTheDocument();
      await user.click(within(bar).getByRole("button", { name: "Settings" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/settings/general"));
    });

    it("no longer carries the sidebar footer, the action bar or the class header", async () => {
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      expect(screen.queryByRole("button", { name: "Jobs" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Choose Knowledge folder/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Update knowledge/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Course modes" })).not.toBeInTheDocument();
    });
  });

  describe("library status pill", () => {
    it("says Library up to date with the last job's age", async () => {
      await renderAppAtRoute("/course/cell-biology/overview", {
        list_jobs: () => [
          {
            id: "job-ok",
            status: "succeeded",
            trigger_kind: "manual",
            skill: null,
            model_id: "grok-4.7",
            started_at: new Date(Date.now() - 2.5 * 3_600_000).toISOString(),
            finished_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
            error_summary: null,
            exit_code: 0,
          },
        ],
      });
      await waitFor(() => {
        expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Library up to date · 2h ago");
      });
    });

    it("says Updating 2 of 3 with the step while an update runs", async () => {
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      act(() => {
        useJobStore.setState({
          status: "running",
          root: FIXTURE_ROOT_FALL,
          progress: { index: 2, total: 3 },
          step: "Membrane transport",
        });
      });
      expect(screen.getByTestId("library-status-pill")).toHaveTextContent(
        "Updating 2 of 3 · Membrane transport",
      );
    });

    it("names the library when the running update belongs to another one", async () => {
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      act(() => {
        useJobStore.setState({
          status: "running",
          root: FIXTURE_ROOT_SHARED,
          progress: { index: 2, total: 3 },
        });
      });
      expect(screen.getByTestId("library-status-pill")).toHaveTextContent(
        "Shared · Study group · Updating 2 of 3",
      );
    });

    it("says No Knowledge folder when no library is chosen, and a click chooses one", async () => {
      await renderAppAtRoute("/welcome", {
        get_settings: () => ({
          ...fixtureSettings,
          knowledge_root: null,
          active_root: null,
          knowledge_roots: [],
        }),
      });
      await waitFor(() => {
        expect(screen.getByTestId("library-status-pill")).toHaveTextContent("No Knowledge folder");
      });
    });

    it("shows a neutral loading state, not a choose-folder button, until settings resolve", async () => {
      let resolveSettings: ((value: typeof fixtureSettings) => void) | undefined;
      await renderAppAtRoute("/course/cell-biology/overview", {
        get_settings: () =>
          new Promise<typeof fixtureSettings>((resolve) => {
            resolveSettings = resolve;
          }),
      });
      const pill = await screen.findByTestId("library-status-pill");
      expect(pill).toHaveTextContent("Loading library");
      expect(pill).not.toHaveTextContent("No Knowledge folder");
      expect(pill).toBeDisabled();
      expect(pill).not.toHaveAttribute("title", "Choose Knowledge folder");
      act(() => {
        resolveSettings?.(fixtureSettings);
      });
      await waitFor(() => {
        expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Library up to date");
      });
    });

    it("flags a failed job of this library", async () => {
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      act(() => {
        useJobStore.setState({ status: "failed", lastFinishedJobId: "job-failed-1" });
      });
      await waitFor(() => {
        expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Last update failed");
      });
    });

    it("names the library on any running job of another one, not only updates with progress", async () => {
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      act(() => {
        useJobStore.getState().start("job-sh-1", { label: "Generating flashcards", root: FIXTURE_ROOT_SHARED });
      });
      expect(screen.getByTestId("library-status-pill")).toHaveTextContent(
        "Shared · Study group · Generating flashcards",
      );
      act(() => {
        useJobStore.getState().start("job-sh-2", { isUpdate: true, root: FIXTURE_ROOT_SHARED });
      });
      expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Shared · Study group · Running");
    });

    it("keeps this library's pill idle, and All jobs off the job, when another library's job failed", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      act(() => {
        useJobStore.getState().start("job-sh-1", { isUpdate: true, root: FIXTURE_ROOT_SHARED });
      });
      act(() => {
        resetJobStoreForRootSwitch();
      });
      act(() => {
        useJobStore.getState().finish({ job_id: "job-sh-1", status: "failed" } as never);
      });
      await waitFor(() => {
        expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Library up to date");
      });
      expect(screen.getByTestId("library-status-pill")).not.toHaveTextContent("failed");
      await user.click(await screen.findByTestId("library-status-pill"));
      await user.click(await screen.findByRole("menuitem", { name: /All jobs/i }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/jobs");
      });
      expect(router.state.location.search.job).not.toBe("job-sh-1");
    });

    it("says Last update failed when the failed job is an update", async () => {
      await renderAppAtRoute("/course/cell-biology/overview", {
        list_jobs: () => [
          {
            id: "job-failed-1",
            status: "failed",
            trigger_kind: "manual",
            skill: null,
            model_id: "grok-4.7",
            started_at: new Date(Date.now() - 3_600_000).toISOString(),
            finished_at: new Date(Date.now() - 3_000_000).toISOString(),
            error_summary: "boom",
            exit_code: 1,
          },
        ],
      });
      await waitForCourseOverview();
      act(() => {
        useJobStore.setState({ status: "failed", lastFinishedJobId: "job-failed-1" });
      });
      await waitFor(() => {
        expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Last update failed");
      });
    });
  });

  describe("library menu", () => {
    it("Update knowledge plans the update and opens the review with the new files", async () => {
      const user = userEvent.setup();
      clearMockIpcLog();
      await renderAppAtRoute("/course/cell-biology/overview", {
        plan_update: () => ({
          pending: [
            {
              path: "cell-biology/week1.pdf",
              course: "cell-biology",
              source_type: "pdf",
              page_count: 10,
              suggested_ranges: [],
              alignment_status: "aligned",
              previously_digested: false,
            },
            {
              path: "cell-biology/week2.pdf",
              course: "cell-biology",
              source_type: "pdf",
              page_count: 12,
              suggested_ranges: [],
              alignment_status: "aligned",
              previously_digested: false,
            },
          ],
        }),
      });
      await waitForCourseOverview();
      const menu = await openLibraryMenu(user);
      await waitFor(() => {
        expect(within(menu).getByRole("menuitem", { name: /Update knowledge/i })).toHaveTextContent(
          "2 new files",
        );
      });
      await user.click(within(menu).getByRole("menuitem", { name: /Update knowledge/i }));
      await waitFor(() => {
        expect(useUpdatePlanStore.getState().open).toBe(true);
        expect(useUpdatePlanStore.getState().pending).toHaveLength(2);
      });
    });

    it("Check citations starts the citations job for the open class", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      const menu = await openLibraryMenu(user);
      await user.click(within(menu).getByRole("menuitem", { name: /Check citations/i }));
      await waitFor(() => {
        const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
        expect(call?.args).toMatchObject({
          root: FIXTURE_ROOT_FALL,
          course: "cell-biology",
          skill: "citations",
        });
      });
    });

    it("names the class Check citations runs on when no class is open", async () => {
      const user = userEvent.setup();
      useUiStore.setState({ lastCourse: { root: FIXTURE_ROOT_FALL, course: "cell-biology" } });
      await renderAppAtRoute("/settings/general");
      await screen.findByRole("button", { name: /Library status/i });
      const menu = await openLibraryMenu(user);
      expect(within(menu).getByRole("menuitem", { name: /Check citations/i })).toHaveTextContent(
        "Check citations · Cell Biology",
      );
    });

    it("keeps plain Check citations inside a class", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      const menu = await openLibraryMenu(user);
      expect(within(menu).getByRole("menuitem", { name: /Check citations/i })).toHaveTextContent(/^Check citations$/);
    });

    it("counts the new files again each time the menu opens", async () => {
      const user = userEvent.setup();
      clearMockIpcLog();
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      await openLibraryMenu(user);
      await waitFor(() => {
        expect(getMockIpcCalls().filter((c) => c.cmd === "plan_update")).toHaveLength(1);
      });
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
      await openLibraryMenu(user);
      await waitFor(() => {
        expect(getMockIpcCalls().filter((c) => c.cmd === "plan_update")).toHaveLength(2);
      });
    });

    it("Show log opens the log drawer", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      const menu = await openLibraryMenu(user);
      await user.click(within(menu).getByRole("menuitem", { name: /Show log/i }));
      await waitFor(() => expect(useUiStore.getState().logOpen).toBe(true));
    });

    it("All jobs opens Jobs, on the failed job when there is one", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      act(() => {
        useJobStore.setState({ status: "failed", lastFinishedJobId: "job-failed-1" });
      });
      const menu = await openLibraryMenu(user);
      await user.click(within(menu).getByRole("menuitem", { name: /All jobs/i }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/jobs");
        expect(router.state.location.search.job).toBe("job-failed-1");
      });
    });

    it("ends with the provider line and its weekly limit", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute("/course/cell-biology/overview");
      await waitForCourseOverview();
      const menu = await openLibraryMenu(user);
      await waitFor(() => {
        expect(within(menu).getByTestId("library-menu-provider")).toHaveTextContent(
          "Grok · signed in · 63% of weekly limit left",
        );
      });
    });

    it("disables the writing items for viewer libraries", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute("/course/cell-biology/overview", {
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
      const menu = await openLibraryMenu(user);
      await waitFor(() => {
        expect(within(menu).getByRole("menuitem", { name: /Update knowledge/i })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        expect(within(menu).getByRole("menuitem", { name: /Check citations/i })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        expect(within(menu).getByTestId("viewer-write-hint")).toHaveTextContent(/Viewer role/i);
      });
    });
  });

  describe("sidebar", () => {
    it("shows Today with the due total of every library and each class's due count", async () => {
      await renderAppAtRoute("/course/cell-biology/overview", { study_today: TWO_LIBRARIES_TODAY });
      const sidebar = await screen.findByRole("complementary");
      await waitFor(() => {
        expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveTextContent("22 due");
      });
      expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveAttribute("href", "/");
      expect(within(sidebar).getByRole("button", { name: /^Cell Biology\s*14$/ })).toBeInTheDocument();
      expect(within(sidebar).getByRole("button", { name: /^Organic Chemistry II\s*5$/ })).toBeInTheDocument();
      expect(within(sidebar).getByRole("button", { name: /^Collab Notes\s*3$/ })).toBeInTheDocument();
      expect(within(sidebar).getByRole("button", { name: "Linear Algebra" })).toBeInTheDocument();
    });

    it("groups the classes by library, with a shared tag on the shared one", async () => {
      await renderAppAtRoute("/course/cell-biology/overview");
      const sidebar = await screen.findByRole("complementary");
      await waitFor(() => {
        expect(within(sidebar).getByText("Fall 2026")).toBeInTheDocument();
        expect(within(sidebar).getByText("Shared · Study group")).toBeInTheDocument();
      });
      expect(within(sidebar).getByText("shared")).toBeInTheDocument();
    });

    it("shows class names while a slow library has not answered, and its count when it does", async () => {
      let releaseShared: (value: TodayPayload) => void = () => {};
      const sharedPending = new Promise<TodayPayload>((resolve) => {
        releaseShared = resolve;
      });
      await renderAppAtRoute("/course/cell-biology/overview", {
        study_today: (args: unknown) =>
          (args as { root?: string }).root === FIXTURE_ROOT_SHARED
            ? sharedPending
            : todayPayload([todayRow("cell-biology", 14)]),
      });
      const sidebar = await screen.findByRole("complementary");
      await waitFor(() => {
        expect(within(sidebar).getByRole("button", { name: /^Cell Biology\s*14$/ })).toBeInTheDocument();
      });
      expect(within(sidebar).getByRole("button", { name: "Collab Notes" })).toBeInTheDocument();
      expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveTextContent("14 due");
      act(() => releaseShared(todayPayload([todayRow("collab-notes", 3)])));
      await waitFor(() => {
        expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveTextContent("17 due");
      });
    });

    it("marks the open class", async () => {
      await renderAppAtRoute("/course/cell-biology/overview");
      const sidebar = await screen.findByRole("complementary");
      await waitFor(() => {
        expect(within(sidebar).getByRole("button", { name: /Cell Biology/ })).toHaveAttribute(
          "aria-current",
          "page",
        );
      });
      expect(within(sidebar).getByRole("button", { name: /Organic Chemistry/ })).not.toHaveAttribute(
        "aria-current",
      );
    });
  });

  describe("settings mode", () => {
    it("replaces the class sidebar with the settings nav and a Back to library button", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute("/settings/general");
      const sidebar = await screen.findByRole("complementary");
      await waitFor(() => {
        expect(within(sidebar).getByRole("button", { name: /Back to library/i })).toBeInTheDocument();
      });
      const nav = within(sidebar).getByRole("navigation", { name: "Settings sections" });
      for (const name of [
        "General",
        "Provider & models",
        "Library & sharing",
        "Sync",
        "Skills",
        "Workers",
        "Shortcuts",
      ]) {
        expect(within(nav).getByRole("button", { name })).toBeInTheDocument();
      }
      expect(within(nav).getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
      expect(within(sidebar).queryByRole("link", { name: /Today/ })).not.toBeInTheDocument();
      expect(within(sidebar).queryByRole("button", { name: /Cell Biology/ })).not.toBeInTheDocument();

      await user.click(within(nav).getByRole("button", { name: "Sync" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/settings/sync"));
      await user.click(within(sidebar).getByRole("button", { name: /Back to library/i }));
      await waitFor(() => expect(router.state.location.pathname).not.toMatch(/^\/settings/));
    });

    it("keeps every settings section reachable while the sidebar is closed", async () => {
      const user = userEvent.setup();
      useUiStore.setState({ sidebarOpen: false, sidebarTouched: true });
      const { router } = await renderAppAtRoute("/settings/general");
      const switcher = await screen.findByRole("navigation", { name: "Switch settings section" });
      expect(within(screen.getByTestId("settings-view")).getByRole("navigation", { name: "Switch settings section" })).toBe(
        switcher,
      );
      for (const name of [
        "General",
        "Provider & models",
        "Library & sharing",
        "Sync",
        "Skills",
        "Workers",
        "Shortcuts",
      ]) {
        expect(within(switcher).getByRole("button", { name })).toBeInTheDocument();
      }
      expect(within(switcher).getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
      await user.click(within(switcher).getByRole("button", { name: "Sync" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/settings/sync"));
      expect(within(switcher).getByRole("button", { name: "Sync" })).toHaveAttribute("aria-current", "page");
    });

    it("shows no inline section switcher while the sidebar is open", async () => {
      await renderAppAtRoute("/settings/general");
      await screen.findByRole("navigation", { name: "Settings sections" });
      expect(screen.queryByRole("navigation", { name: "Switch settings section" })).not.toBeInTheDocument();
    });

    it("keeps the top bar and the status pill in settings", async () => {
      await renderAppAtRoute("/settings/general");
      await waitFor(() => {
        expect(screen.getByTestId("library-status-pill")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /Search notes, concepts/i })).toBeInTheDocument();
    });
  });
});
