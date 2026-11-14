import { create } from "zustand";

import type { JobFinished, WorkerEvent } from "~/domain/types";
import { useUiStore } from "~/stores/ui-store";

const MAX_LINES = 5000;

export type JobStoreStatus = "idle" | "running" | "failed" | "done";

/** Position of the update run: source `index` of `total` (0 until the first source starts). */
export type JobProgress = { index: number; total: number };

interface JobState {
  activeJobId: string | null;
  activeUpdateJobId: string | null;
  lastFinishedJobId: string | null;
  lastFinishedStatus: JobFinished["status"] | null;
  status: JobStoreStatus;
  step: string | null;
  label: string | null;
  /** The library the running job belongs to; null when nothing runs. */
  root: string | null;
  /** "Updating 2 of 3": set from `planned` and `source_started`, cleared when the run ends. */
  progress: JobProgress | null;
  lines: string[];
  unread: number;
  append: (line: string) => void;
  appendBatch: (lines: string[]) => void;
  markRead: () => void;
  clear: () => void;
  start: (
    jobId: string,
    opts?: { isUpdate?: boolean; label?: string; root?: string | null },
  ) => void;
  finish: (result: JobFinished) => void;
  setStep: (step: string | null) => void;
}

/**
 * Switching library resets finished-job state only. A running job belongs to the process, not
 * to the library on screen: it keeps its status, step, label, library and progress so the
 * pill can show "<library> · Updating 2 of 3" from anywhere (Q24).
 */
export function resetJobStoreForRootSwitch() {
  if (useJobStore.getState().status === "running") {
    useJobStore.setState({ lastFinishedJobId: null, lastFinishedStatus: null });
    return;
  }
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
}

/** Feed worker events in: `planned` sets the total, `source_started` the position (I13). */
export function applyWorkerEventToJobProgress(ev: WorkerEvent) {
  const state = useJobStore.getState();
  if (state.status !== "running") {
    return;
  }
  if (ev.type === "planned" && typeof ev.total === "number") {
    useJobStore.setState({ progress: { index: 0, total: ev.total } });
  } else if (
    ev.type === "source_started" &&
    typeof ev.index === "number" &&
    typeof ev.total === "number"
  ) {
    useJobStore.setState({ progress: { index: ev.index, total: ev.total } });
  }
}

export const useJobStore = create<JobState>((set, get) => ({
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
  append(line) {
    get().appendBatch([line]);
  },
  appendBatch(batchLines) {
    if (batchLines.length === 0) {
      return;
    }
    const logOpen = useUiStore.getState().logOpen;
    set((state) => {
      const next = [...state.lines, ...batchLines];
      const trimmed = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      const dropped = next.length - trimmed.length;
      const added = batchLines.length - dropped;
      return {
        lines: trimmed,
        unread: logOpen ? state.unread : state.unread + Math.max(0, added),
      };
    });
  },
  markRead() {
    set({ unread: 0 });
  },
  clear() {
    set({ lines: [], unread: 0 });
  },
  start(jobId, opts) {
    set({
      activeJobId: jobId,
      activeUpdateJobId: opts?.isUpdate ? jobId : get().activeUpdateJobId,
      status: "running",
      step: null,
      label: opts?.label ?? null,
      root: opts?.root ?? null,
      progress: null,
    });
  },
  finish(result) {
    const cancelled = result.status === "cancelled";
    const wasActive = get().activeJobId === result.job_id;
    set((state) => ({
      activeJobId: state.activeJobId === result.job_id ? null : state.activeJobId,
      activeUpdateJobId:
        state.activeUpdateJobId === result.job_id ? null : state.activeUpdateJobId,
      lastFinishedJobId: wasActive ? result.job_id : state.lastFinishedJobId,
      lastFinishedStatus: wasActive ? result.status : state.lastFinishedStatus,
      status: cancelled ? "idle" : result.status === "succeeded" ? "done" : "failed",
      step: null,
      label: state.activeJobId === result.job_id ? null : state.label,
      root: state.activeJobId === result.job_id ? null : state.root,
      progress: state.activeJobId === result.job_id ? null : state.progress,
    }));
  },
  setStep(step) {
    set({ step });
  },
}));
