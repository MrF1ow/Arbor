import { emit } from "@tauri-apps/api/event";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { FIXTURE_ROOT_FALL, fixtureSettings } from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { cleanupTestQueryClients } from "~/test/query-clients";
import { renderAppAtRoute } from "~/test/render";

const FIXED_NOW = new Date("2026-10-20T12:00:00Z");

function jobsView() {
  return screen.getByTestId("jobs-view");
}

async function waitForJobsReady() {
  await waitFor(() => {
    expect(jobsView()).toBeInTheDocument();
    expect(within(jobsView()).getByTestId("job-row-mock-update-job")).toBeInTheDocument();
  });
}

describe("jobs page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true });
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      lastFinishedJobId: null,
      lastFinishedStatus: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
    });
  });

  afterEach(() => {
    clearTauriMocks();
    clearMockIpcLog();
    resetMockHandlerTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stacks the header, filter chips, job table and log in one column", async () => {
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();

    const view = within(jobsView());
    const heading = view.getByRole("heading", { name: "Jobs" });
    const chips = view.getByRole("group", { name: "Filter jobs by status" });
    const table = view.getByRole("table");
    const log = view.getByTestId("job-log-panel");
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(heading, chips)).toBe(true);
    expect(follows(chips, table)).toBe(true);
    expect(follows(table, log)).toBe(true);
    expect(view.getByText("Job history from your Knowledge folder.")).toBeInTheDocument();
  });

  it("shows one Toggle Sidebar button, the top bar's, when the sidebar is closed", async () => {
    useUiStore.setState({ sidebarOpen: false, sidebarTouched: true });
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();

    expect(screen.getAllByRole("button", { name: "Toggle Sidebar" })).toHaveLength(1);
  });

  it("renders job names, status tags, the error and the duration", async () => {
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();

    const view = within(jobsView());
    expect(view.getAllByText("Update knowledge").length).toBeGreaterThan(0);
    expect(view.getByText("Generate flashcards")).toBeInTheDocument();
    expect(view.getByText("Worker timeout")).toBeInTheDocument();
    expect(view.getAllByText("Succeeded").length).toBeGreaterThan(0);
    expect(view.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(view.getByText("7 min")).toBeInTheDocument();
  });

  it("selects the first job by default and syncs ?job=", async () => {
    const { router } = await renderAppAtRoute("/jobs");
    await waitForJobsReady();
    await waitFor(() => {
      expect(router.state.location.search.job).toBe("mock-update-job");
    });
  });

  it("deep link ?job= selects that job", async () => {
    const { router } = await renderAppAtRoute("/jobs?job=job-failed-1");
    await waitForJobsReady();
    const row = within(jobsView()).getByTestId("job-row-job-failed-1");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(router.state.location.search.job).toBe("job-failed-1");
  });

  it("loads events when selecting a job", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();

    await user.click(within(jobsView()).getByTestId("job-row-job-failed-1"));
    await waitFor(() => {
      expect(within(jobsView()).getByTestId("job-log-panel")).toHaveTextContent(
        "[job-failed-1] line 1:",
      );
    });
  });

  it("appends live job-store lines for the running active job", async () => {
    useJobStore.setState({
      activeJobId: "mock-update-job",
      activeUpdateJobId: "mock-update-job",
      status: "running",
      lines: ["prior-job-line"],
    });
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();
    useJobStore.getState().append("live tail line");

    await waitFor(() => {
      const panel = within(jobsView()).getByTestId("job-log-panel");
      expect(panel).toHaveTextContent("[mock-update-job] line 1:");
      expect(panel).toHaveTextContent("live tail line");
      expect(panel).not.toHaveTextContent("prior-job-line");
    });
  });

  it("refetches events after job-finished", async () => {
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();

    const callsBefore = getMockIpcCalls().filter((c) => c.cmd === "get_job_events").length;

    await emit("arbor://job-finished", {
      job_id: "mock-update-job",
      status: "succeeded",
      summary: null,
      operation: "update",
      root: FIXTURE_ROOT_FALL,
    });

    await waitFor(() => {
      const callsAfter = getMockIpcCalls().filter((c) => c.cmd === "get_job_events").length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  const runningUpdateJob = {
    id: "mock-update-job",
    status: "running" as const,
    trigger_kind: "manual",
    skill: null,
    model_id: "grok-4.7",
    started_at: "2026-10-20T11:58:00Z",
    finished_at: null,
    error_summary: null,
    exit_code: null,
  };

  it("shows cancel only for the running update job", async () => {
    useJobStore.setState({
      activeJobId: "mock-update-job",
      activeUpdateJobId: "mock-update-job",
      status: "running",
    });
    await renderAppAtRoute("/jobs", {
      list_jobs: () => [runningUpdateJob],
    });
    await waitForJobsReady();
    expect(
      within(jobsView()).getByRole("button", { name: /^Cancel$/i }),
    ).toBeInTheDocument();

    useJobStore.setState({
      activeJobId: "mock-update-job",
      activeUpdateJobId: null,
      status: "running",
    });
    cleanup();
    await cleanupTestQueryClients();
    clearTauriMocks();
    await renderAppAtRoute("/jobs", {
      list_jobs: () => [runningUpdateJob],
    });
    await waitForJobsReady();
    expect(within(jobsView()).queryByRole("button", { name: /^Cancel$/i })).not.toBeInTheDocument();
  });

  it("cancel calls cancel_update", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    useJobStore.setState({
      activeJobId: "mock-update-job",
      activeUpdateJobId: "mock-update-job",
      status: "running",
    });
    await renderAppAtRoute("/jobs", {
      list_jobs: () => [runningUpdateJob],
    });
    await waitForJobsReady();

    await user.click(within(jobsView()).getByRole("button", { name: /^Cancel$/i }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "cancel_update")).toBe(true);
    });
  });

  it("shows no Knowledge folder copy", async () => {
    await renderAppAtRoute("/jobs", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    await waitFor(() => {
      expect(screen.getByText("No Knowledge folder selected")).toBeInTheDocument();
    });
  });

  it("shows no runs yet", async () => {
    await renderAppAtRoute("/jobs", {
      list_jobs: () => [],
    });
    await waitFor(() => {
      expect(within(jobsView()).getByText("No runs yet")).toBeInTheDocument();
    });
  });

  it(
    "shows load error copy",
    async () => {
      vi.useRealTimers();
      await renderAppAtRoute("/jobs", {
        init_arbor_db: () => null,
        list_jobs: () => {
          throw new Error("db locked");
        },
      });
      await waitFor(
        () => {
          expect(screen.getByRole("alert")).toHaveTextContent("Could not load jobs: Error: db locked");
        },
        { timeout: 4000 },
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(FIXED_NOW);
    },
    10_000,
  );

  it("calls init_arbor_db before list_jobs", async () => {
    clearMockIpcLog();
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();
    const calls = getMockIpcCalls().map((c) => c.cmd);
    const dbIdx = calls.indexOf("init_arbor_db");
    const listIdx = calls.indexOf("list_jobs");
    expect(dbIdx).toBeGreaterThanOrEqual(0);
    expect(listIdx).toBeGreaterThan(dbIdx);
  });
});

describe("jobs table", () => {
  const job = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    status,
    trigger_kind: "manual",
    skill: null,
    model_id: "grok-4.7",
    started_at: "2026-10-20T11:00:00Z",
    finished_at: status === "running" ? null : "2026-10-20T11:01:00Z",
    error_summary: status === "failed" ? "provider rate limit" : null,
    exit_code: status === "failed" ? 1 : 0,
    course: null,
    digests: null,
    ...extra,
  });
  const unit2 = ["a", "b", "c"].map((n) => ({
    title: n,
    date: "2026-09-12",
    path: `cell-biology/digests/${n}.md`,
    unit: "Unit 2",
  }));
  const fixtures = {
    list_jobs: () => [
      job("job-run", "running"),
      job("job-fail", "failed", { trigger_kind: "study", skill: "flashcards", course: "cell-biology", digests: ["cell-biology/digests/a.md"] }),
      job("job-quiz", "succeeded", {
        trigger_kind: "study",
        skill: "quiz",
        course: "cell-biology",
        digests: unit2.map((d) => d.path),
      }),
      job("job-ok", "succeeded", { trigger_kind: "study", skill: "concepts", course: "cell-biology", digests: ["cell-biology/digests/a.md", "cell-biology/digests/b.md"] }),
      job("job-off", "cancelled"),
    ],
    list_digests: () => [...unit2, { title: "d", date: "2026-09-01", path: "cell-biology/digests/d.md", unit: "Unit 1" }],
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true });
  });

  afterEach(() => {
    clearTauriMocks();
    clearMockIpcLog();
    resetMockHandlerTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderJobs(route = "/jobs") {
    const rendered = await renderAppAtRoute(route, fixtures);
    await waitFor(() => {
      expect(within(jobsView()).getByTestId("job-row-job-run")).toBeInTheDocument();
    });
    return rendered;
  }

  it("says why Arbor ended a job it found still running", async () => {
    await renderAppAtRoute("/jobs", {
      ...fixtures,
      list_jobs: () => [
        job("job-run", "running"),
        job("job-stale", "cancelled", { error_summary: "Arbor closed before this job finished" }),
        job("job-off", "cancelled"),
      ],
    });
    const stale = await within(jobsView()).findByTestId("job-row-job-stale");
    expect(within(stale).getByText("Arbor closed before this job finished")).toBeInTheDocument();
    expect(
      within(within(jobsView()).getByTestId("job-row-job-off")).queryByText(/Arbor closed/),
    ).not.toBeInTheDocument();
  });

  const rowIds = () =>
    within(jobsView())
      .getAllByTestId(/^job-row-/)
      .map((row) => row.getAttribute("data-testid"));

  it("filters by status with a count on each chip", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await renderJobs();
    const view = within(jobsView());

    expect(view.getByRole("button", { name: "All 5" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByRole("button", { name: "Running 1" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Succeeded 2" })).toBeInTheDocument();
    expect(rowIds()).toHaveLength(5);

    await user.click(view.getByRole("button", { name: "Failed 1" }));
    expect(rowIds()).toEqual(["job-row-job-fail"]);
    expect(view.getByRole("button", { name: "Failed 1" })).toHaveAttribute("aria-pressed", "true");

    await user.click(view.getByRole("button", { name: "Succeeded 2" }));
    expect(rowIds()).toEqual(["job-row-job-quiz", "job-row-job-ok"]);

    await user.click(view.getByRole("button", { name: "Running 1" }));
    expect(rowIds()).toEqual(["job-row-job-run"]);

    await user.click(view.getByRole("button", { name: "All 5" }));
    expect(rowIds()).toHaveLength(5);
  });

  it("reads each job's Scope from its class and lectures", async () => {
    await renderJobs();
    const view = within(jobsView());
    expect(view.getByRole("columnheader", { name: "Scope" })).toBeInTheDocument();

    // Three lectures of Unit 2 (the class also has a Unit 1 lecture), so the unit is named.
    expect(within(view.getByTestId("job-row-job-quiz")).getByText("Cell Biology · Unit 2 · 3 lectures")).toBeInTheDocument();
    // One lecture of the class, in Unit 2.
    expect(within(view.getByTestId("job-row-job-fail")).getByText("Cell Biology · Unit 2 · 1 lecture")).toBeInTheDocument();
    // Lectures a and b share Unit 2.
    expect(within(view.getByTestId("job-row-job-ok")).getByText("Cell Biology · Unit 2 · 2 lectures")).toBeInTheDocument();
    // An update with no single class has no scope.
    expect(within(view.getByTestId("job-row-job-run")).getByText("—", { selector: "[data-column=scope] *" })).toBeInTheDocument();
  });

  it("shows the selected job's log below the table", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await renderJobs();
    const view = within(jobsView());

    await user.click(view.getByTestId("job-row-job-fail"));
    const panel = await view.findByTestId("job-log-panel");
    await waitFor(() => {
      expect(panel).toHaveTextContent("Log · Generate flashcards · Cell Biology · Unit 2 · 1 lecture");
      expect(panel).toHaveTextContent("[job-fail] line 1:");
    });
    const table = view.getByRole("table");
    expect(table.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.getByTestId("job-row-job-fail")).toHaveAttribute("aria-current", "true");
  });

  it("shows the Log button on finished rows and selects the row", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { router } = await renderJobs();
    const view = within(jobsView());
    await user.click(within(view.getByTestId("job-row-job-ok")).getByRole("button", { name: "Log" }));
    await waitFor(() => {
      expect(router.state.location.search.job).toBe("job-ok");
    });
  });

  it("opens the class from its scope through the library-aware link", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { router } = await renderJobs();
    await user.click(
      within(within(jobsView()).getByTestId("job-row-job-quiz")).getByRole("button", { name: /Cell Biology/ }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/overview");
    });
  });

  it("fills the running job's bar from the update's position", async () => {
    useJobStore.setState({
      activeJobId: "job-run",
      activeUpdateJobId: "job-run",
      status: "running",
      progress: { index: 2, total: 3 },
    });
    await renderJobs();
    const bar = within(within(jobsView()).getByTestId("job-row-job-run")).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "67");
    useJobStore.setState({ activeJobId: null, activeUpdateJobId: null, status: "idle", progress: null });
  });

  it("drops the log of a job a filter chip hides", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await renderJobs();
    const view = within(jobsView());
    await user.click(view.getByTestId("job-row-job-ok"));
    expect(view.getByTestId("job-row-job-ok")).toHaveAttribute("aria-current", "true");

    await user.click(view.getByRole("button", { name: "Failed 1" }));
    expect(rowIds()).toEqual(["job-row-job-fail"]);
    // The log follows a listed row: the failed job, never the hidden one.
    expect(view.getByTestId("job-row-job-fail")).toHaveAttribute("aria-current", "true");
    expect(view.getByTestId("job-log-panel")).toHaveTextContent("Generate flashcards");
    expect(view.getByTestId("job-log-panel")).not.toHaveTextContent("Extract concepts");
  });

  it("shows no log when the filter lists no job", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await renderAppAtRoute("/jobs", { ...fixtures, list_jobs: () => [job("only-ok", "succeeded")] });
    await waitFor(() => {
      expect(within(jobsView()).getByTestId("job-row-only-ok")).toBeInTheDocument();
    });
    expect(within(jobsView()).getByTestId("job-log-panel")).toBeInTheDocument();
    await user.click(within(jobsView()).getByRole("button", { name: "Failed 0" }));
    expect(within(jobsView()).queryByTestId("job-log-panel")).not.toBeInTheDocument();
    expect(within(jobsView()).getByText("Select a job to view its log.")).toBeInTheDocument();
  });

  describe("with a full page of jobs", () => {
    const many = Array.from({ length: 15 }, (_, index) => job(`job-${index}`, "succeeded"));
    const scrolled: HTMLElement[] = [];
    const original = Element.prototype.scrollIntoView;

    beforeEach(() => {
      scrolled.length = 0;
      Element.prototype.scrollIntoView = function (this: HTMLElement) {
        scrolled.push(this);
      };
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });

    it("caps the table with its own scroll so the log keeps room", async () => {
      await renderAppAtRoute("/jobs", { ...fixtures, list_jobs: () => many });
      await waitFor(() => {
        expect(within(jobsView()).getByTestId("job-row-job-14")).toBeInTheDocument();
      });
      const container = within(jobsView()).getByTestId("job-list-container");
      expect(container.className).toContain("max-h-jobs-pane");
      expect(container.className).toContain("overflow-y-auto");
    });

    it("scrolls the log into view when a row is picked", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      await renderAppAtRoute("/jobs", { ...fixtures, list_jobs: () => many });
      await waitFor(() => {
        expect(within(jobsView()).getByTestId("job-row-job-14")).toBeInTheDocument();
      });
      scrolled.length = 0;
      await user.click(within(jobsView()).getByTestId("job-row-job-14"));
      expect(scrolled.some((el) => el.contains(within(jobsView()).getByTestId("job-log-panel")))).toBe(true);
    });

    it("scrolls the log into view for a ?job= deep link", async () => {
      await renderAppAtRoute("/jobs?job=job-12", { ...fixtures, list_jobs: () => many });
      await waitFor(() => {
        expect(within(jobsView()).getByTestId("job-row-job-12")).toHaveAttribute("aria-current", "true");
      });
      await waitFor(() => {
        expect(scrolled.some((el) => el.contains(within(jobsView()).getByTestId("job-log-panel")))).toBe(true);
      });
    });
  });

  it("shows a filter with no matches as an empty table message", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await renderAppAtRoute("/jobs", { ...fixtures, list_jobs: () => [job("only-ok", "succeeded")] });
    await waitFor(() => {
      expect(within(jobsView()).getByTestId("job-row-only-ok")).toBeInTheDocument();
    });
    await user.click(within(jobsView()).getByRole("button", { name: "Failed 0" }));
    expect(within(jobsView()).getByText("No failed jobs")).toBeInTheDocument();
  });
});

describe("library status pill", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
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
  });

  afterEach(() => {
    clearTauriMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows idle text from the latest job and links failed state to jobs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", {
      list_jobs: () => [
        {
          id: "job-ok-1",
          status: "succeeded",
          trigger_kind: "watch",
          model_id: "grok-4.7",
          started_at: "2026-10-20T11:50:00Z",
          finished_at: "2026-10-20T11:55:00Z",
          error_summary: null,
          exit_code: 0,
        },
        {
          id: "job-failed-1",
          status: "failed",
          trigger_kind: "manual",
          model_id: "grok-4.7",
          started_at: "2026-10-01T10:00:00Z",
          finished_at: "2026-10-01T10:05:00Z",
          error_summary: "Worker timeout",
          exit_code: 1,
        },
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId("library-status-pill")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Library up to date ·/)).toBeInTheDocument();
    });

    useJobStore.setState({
      status: "failed",
      lastFinishedJobId: "job-failed-1",
      lastFinishedStatus: "failed",
    });
    await waitFor(() => {
      expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Last update failed");
    });

    await user.click(screen.getByTestId("library-status-pill"));
    await user.click(await screen.findByRole("menuitem", { name: /All jobs/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/jobs");
      expect(router.state.location.search.job).toBe("job-failed-1");
    });
  });

  it("links to the latest failed job after reload when the store is idle", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", {
      list_jobs: () => [
        {
          id: "job-failed-reload",
          status: "failed",
          trigger_kind: "manual",
          skill: null,
          model_id: "grok-4.7",
          started_at: "2026-10-01T10:00:00Z",
          finished_at: "2026-10-01T10:05:00Z",
          error_summary: "Worker timeout",
          exit_code: 1,
        },
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId("library-status-pill")).toHaveTextContent("Last update failed");
    });
    await user.click(screen.getByTestId("library-status-pill"));
    await user.click(await screen.findByRole("menuitem", { name: /All jobs/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/jobs");
      expect(router.state.location.search.job).toBe("job-failed-reload");
    });
  });

  it("navigates to jobs from idle pill when up to date", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitFor(() => {
      expect(screen.getByText(/Library up to date ·/)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("library-status-pill"));
    await user.click(await screen.findByRole("menuitem", { name: /All jobs/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/jobs");
    });
  });
});
