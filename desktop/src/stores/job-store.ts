import { create } from "zustand";

import type { JobFinished } from "~/domain/types";
import { useUiStore } from "~/stores/ui-store";

const MAX_LINES = 5000;

export type JobStoreStatus = "idle" | "running" | "failed" | "done";

interface JobState {
  activeJobId: string | null;
  activeUpdateJobId: string | null;
  status: JobStoreStatus;
  step: string | null;
  label: string | null;
  lines: string[];
  unread: number;
  append: (line: string) => void;
  appendBatch: (lines: string[]) => void;
  markRead: () => void;
  clear: () => void;
  start: (jobId: string, opts?: { isUpdate?: boolean; label?: string }) => void;
  finish: (result: JobFinished) => void;
  setStep: (step: string | null) => void;
}

export function resetJobStoreForRootSwitch() {
  useJobStore.setState({
    activeJobId: null,
    activeUpdateJobId: null,
    status: "idle",
    step: null,
    label: null,
    lines: [],
    unread: 0,
  });
}

export const useJobStore = create<JobState>((set, get) => ({
  activeJobId: null,
  activeUpdateJobId: null,
  status: "idle",
  step: null,
  label: null,
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
    });
  },
  finish(result) {
    const cancelled = result.status === "cancelled";
    set((state) => ({
      activeJobId: state.activeJobId === result.job_id ? null : state.activeJobId,
      activeUpdateJobId:
        state.activeUpdateJobId === result.job_id ? null : state.activeUpdateJobId,
      status: cancelled ? "idle" : result.status === "succeeded" ? "done" : "failed",
      step: null,
      label: state.activeJobId === result.job_id ? null : state.label,
    }));
  },
  setStep(step) {
    set({ step });
  },
}));
