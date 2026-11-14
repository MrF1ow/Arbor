import { beforeEach, describe, expect, it } from "vitest";

import { JOB_START_LABEL } from "~/domain/job-labels";
import { applyWorkerEventToJobProgress, resetJobStoreForRootSwitch, useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";

describe("job-store", () => {
  beforeEach(() => {
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
      root: null,
      progress: null,
    });
    useUiStore.setState({ logOpen: false });
  });

  it("caps the ring buffer at 5000 lines", () => {
    for (let i = 0; i < 5005; i += 1) {
      useJobStore.getState().append(`line-${i}`);
    }
    expect(useJobStore.getState().lines).toHaveLength(5000);
    expect(useJobStore.getState().lines[0]).toBe("line-5");
  });

  it("increments unread only while the log is closed", () => {
    useJobStore.getState().append("one");
    expect(useJobStore.getState().unread).toBe(1);
    useUiStore.setState({ logOpen: true });
    useJobStore.getState().append("two");
    expect(useJobStore.getState().unread).toBe(1);
    useJobStore.getState().markRead();
    expect(useJobStore.getState().unread).toBe(0);
  });

  it("does not toggle logOpen", () => {
    useJobStore.getState().append("event");
    expect(useUiStore.getState().logOpen).toBe(false);
  });

  it("start stores a job label and finish clears it", () => {
    useJobStore.getState().start("job-1", { label: JOB_START_LABEL.flashcards });
    expect(useJobStore.getState().label).toBe(JOB_START_LABEL.flashcards);
    useJobStore.getState().finish({
      job_id: "job-1",
      status: "succeeded",
      summary: null,
      root: "/mock/knowledge/fall-2026",
      operation: "generate",
    });
    expect(useJobStore.getState().label).toBeNull();
  });

  it("start with isUpdate tracks the update job id", () => {
    useJobStore.getState().start("update-1", {
      isUpdate: true,
      label: JOB_START_LABEL.update,
    });
    expect(useJobStore.getState().activeUpdateJobId).toBe("update-1");
  });

  it("start records the library the job belongs to", () => {
    useJobStore.getState().start("update-1", { isUpdate: true, root: "/k/mine" });
    expect(useJobStore.getState().root).toBe("/k/mine");
    expect(useJobStore.getState().progress).toBeNull();
  });

  it("tracks Updating N of M from planned and source_started, and clears it when the run ends", () => {
    useJobStore.getState().start("update-1", { isUpdate: true, root: "/k/mine" });

    applyWorkerEventToJobProgress({ type: "planned", total: 3 });
    expect(useJobStore.getState().progress).toEqual({ index: 0, total: 3 });

    applyWorkerEventToJobProgress({ type: "source_started", index: 2, total: 3 });
    expect(useJobStore.getState().progress).toEqual({ index: 2, total: 3 });

    applyWorkerEventToJobProgress({ type: "stage", stage: "generate" });
    expect(useJobStore.getState().progress).toEqual({ index: 2, total: 3 });

    useJobStore.getState().finish({
      job_id: "update-1",
      status: "succeeded",
      summary: null,
      root: "/k/mine",
      operation: "update",
    });
    expect(useJobStore.getState().progress).toBeNull();
    expect(useJobStore.getState().root).toBeNull();
  });

  it("keeps a running job and its progress when the library is switched mid-update", () => {
    useJobStore.getState().start("update-1", {
      isUpdate: true,
      label: JOB_START_LABEL.update,
      root: "/k/mine",
    });
    applyWorkerEventToJobProgress({ type: "source_started", index: 2, total: 3 });
    useJobStore.getState().setStep("Cell Biology");
    useJobStore.getState().append("  • week2.pdf");
    useJobStore.setState({ lastFinishedJobId: "old", lastFinishedStatus: "failed" });

    resetJobStoreForRootSwitch();

    const state = useJobStore.getState();
    expect(state.status).toBe("running");
    expect(state.activeJobId).toBe("update-1");
    expect(state.activeUpdateJobId).toBe("update-1");
    expect(state.root).toBe("/k/mine");
    expect(state.progress).toEqual({ index: 2, total: 3 });
    expect(state.step).toBe("Cell Biology");
    expect(state.label).toBe(JOB_START_LABEL.update);
    // Finished-job state is what resets.
    expect(state.lastFinishedJobId).toBeNull();
    expect(state.lastFinishedStatus).toBeNull();
  });

  it("resets everything on a library switch when nothing is running", () => {
    useJobStore.setState({ status: "failed", lastFinishedJobId: "j", lines: ["x"], unread: 1 });
    resetJobStoreForRootSwitch();
    const state = useJobStore.getState();
    expect(state.status).toBe("idle");
    expect(state.lines).toEqual([]);
    expect(state.lastFinishedJobId).toBeNull();
  });

  it("ignores progress events when no job is running", () => {
    applyWorkerEventToJobProgress({ type: "planned", total: 3 });
    expect(useJobStore.getState().progress).toBeNull();
  });
});
