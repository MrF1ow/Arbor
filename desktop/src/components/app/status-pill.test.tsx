import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusPill } from "~/components/app/status-pill";
import { JOB_START_LABEL, runningJobStatusLabel } from "~/domain/job-labels";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";
import { FIXTURE_ROOT_FALL, fixtureSettings } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderAppAtRoute } from "~/test/render";

describe("StatusPill", () => {
  it("renders the running job label from the store pipeline", () => {
    const label = runningJobStatusLabel(null, JOB_START_LABEL.flashcards);
    render(<StatusPill variant="running" label={label} />);
    expect(screen.getByText(JOB_START_LABEL.flashcards)).toBeInTheDocument();
  });
});

// A cancel can leave a class's notebook unbuilt with no file left to process. The menu's
// Update knowledge must then start the update itself, because the review dialog lists files.
describe("library pill: Update knowledge with only a course notebook owed", () => {
  const pendingFile = {
    path: "cell-biology/week1.pdf",
    course: "cell-biology",
    source_type: "pdf",
    page_count: 10,
    suggested_ranges: [],
    alignment_status: "ambiguous",
    previously_digested: false,
  };

  beforeEach(() => {
    clearMockIpcLog();
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
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
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
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  async function clickUpdateKnowledge(plan: unknown) {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", { plan_update: () => plan });
    await waitFor(() => {
      expect(screen.getAllByText("Course overview").length).toBeGreaterThan(0);
    });
    await user.click(await screen.findByTestId("library-status-pill"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: /Update knowledge/i }));
  }

  const startUpdateCalls = () => getMockIpcCalls().filter((c) => c.cmd === "start_update");

  it("starts the update with no file selections and skips the review dialog", async () => {
    await clickUpdateKnowledge({ pending: [], synthesis_pending: ["Cardiology"] });

    await waitFor(() => {
      expect(startUpdateCalls()).toHaveLength(1);
    });
    expect(startUpdateCalls()[0]?.args).toMatchObject({
      root: FIXTURE_ROOT_FALL,
      selections: [],
      trigger: "manual",
      model: expect.any(String),
      provider: expect.any(String),
    });
    expect(useUpdatePlanStore.getState().open).toBe(false);
    await waitFor(() => {
      expect(useJobStore.getState().lines.some((l) => /Job .* started/.test(l))).toBe(true);
    });
  });

  it("says to select a model, not Nothing to process, when a notebook is owed and no model is set", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", {
      plan_update: () => ({ pending: [], synthesis_pending: ["Cardiology"] }),
      get_settings: () => ({ ...fixtureSettings, model_id: null, provider_overrides: [] }),
    });
    await waitFor(() => {
      expect(screen.getAllByText("Course overview").length).toBeGreaterThan(0);
    });
    await user.click(await screen.findByTestId("library-status-pill"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: /Update knowledge/i }));

    await waitFor(() => {
      expect(useJobStore.getState().lines.some((l) => l.includes("Select a model in Settings."))).toBe(true);
    });
    expect(startUpdateCalls()).toHaveLength(0);
    expect(useJobStore.getState().lines.some((l) => l.includes("Nothing to process"))).toBe(false);
  });

  it("still logs Nothing to process when no file and no notebook is pending", async () => {
    await clickUpdateKnowledge({ pending: [], synthesis_pending: [] });

    await waitFor(() => {
      expect(useJobStore.getState().lines.some((l) => l.includes("Nothing to process"))).toBe(true);
    });
    expect(startUpdateCalls()).toHaveLength(0);
    expect(useUpdatePlanStore.getState().open).toBe(false);
  });

  it("treats a plan from an older worker, with no synthesis_pending key, as nothing to do", async () => {
    await clickUpdateKnowledge({ pending: [] });

    await waitFor(() => {
      expect(useJobStore.getState().lines.some((l) => l.includes("Nothing to process"))).toBe(true);
    });
    expect(startUpdateCalls()).toHaveLength(0);
  });

  it("opens the review dialog as before when files are pending, even with a notebook owed", async () => {
    await clickUpdateKnowledge({ pending: [pendingFile], synthesis_pending: ["Cardiology"] });

    await waitFor(() => {
      expect(useUpdatePlanStore.getState().open).toBe(true);
    });
    expect(startUpdateCalls()).toHaveLength(0);
  });
});
