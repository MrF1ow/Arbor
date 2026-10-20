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
  lines: string[];
  unread: number;
  append: (line: string) => void;
  markRead: () => void;
  start: (jobId: string, opts?: { isUpdate?: boolean }) => void;
  finish: (result: JobFinished) => void;
  setStep: (step: string | null) => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  activeJobId: null,
  activeUpdateJobId: null,
  status: "idle",
  step: null,
  lines: [],
  unread: 0,
  append(line) {
    const logOpen = useUiStore.getState().logOpen;
    set((state) => {
      const next = [...state.lines, line];
      const trimmed = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      return {
        lines: trimmed,
        unread: logOpen ? state.unread : state.unread + 1,
      };
    });
  },
  markRead() {
    set({ unread: 0 });
  },
  start(jobId, opts) {
    set({
      activeJobId: jobId,
      activeUpdateJobId: opts?.isUpdate ? jobId : get().activeUpdateJobId,
      status: "running",
      step: null,
    });
  },
  finish(result) {
    set((state) => ({
      activeJobId: state.activeJobId === result.job_id ? null : state.activeJobId,
      activeUpdateJobId:
        state.activeUpdateJobId === result.job_id ? null : state.activeUpdateJobId,
      status: result.status === "succeeded" ? "done" : "failed",
      step: null,
    }));
  },
  setStep(step) {
    set({ step });
  },
}));
