import { emit } from "@tauri-apps/api/event";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { FIXTURE_ROOT_FALL, fixtureSettings } from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { useJobStore } from "~/stores/job-store";
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
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
    });
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    clearMockIpcLog();
    resetMockHandlerTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders job labels, status, relative time, duration, model, and error line", async () => {
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();

    const view = within(jobsView());
    expect(view.getAllByText("Manual update").length).toBeGreaterThan(0);
    expect(view.getByText("Worker timeout")).toBeInTheDocument();
    expect(view.getAllByText("grok-4.7").length).toBeGreaterThan(0);
    expect(view.getByText("2 min ago")).toBeInTheDocument();
    expect(view.getByText("running")).toBeInTheDocument();
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
      lines: ["live tail line"],
    });
    await renderAppAtRoute("/jobs");
    await waitForJobsReady();

    await waitFor(() => {
      const panel = within(jobsView()).getByTestId("job-log-panel");
      expect(panel).toHaveTextContent("[mock-update-job] line 1:");
      expect(panel).toHaveTextContent("live tail line");
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

  it("shows cancel only for the running update job", async () => {
    useJobStore.setState({
      activeJobId: "mock-update-job",
      activeUpdateJobId: "mock-update-job",
      status: "running",
    });
    await renderAppAtRoute("/jobs");
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
    clearMocks();
    await renderAppAtRoute("/jobs");
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
    await renderAppAtRoute("/jobs");
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

describe("action bar status pill", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
    });
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows idle text from the latest job and links failed state to jobs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { router } = await renderAppAtRoute("/course/cell-biology/notes", {
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
      expect(screen.getByTestId("status-pill-button")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Up to date ·/)).toBeInTheDocument();
    });

    useJobStore.setState({ status: "failed" });
    await waitFor(() => {
      expect(screen.getByText("Last job failed")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("status-pill-button"));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/jobs");
      expect(router.state.location.search.job).toBe("job-failed-1");
    });
  });
});
