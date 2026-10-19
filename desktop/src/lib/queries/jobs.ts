import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { JobEventRow, JobSummary, UpdatePlan } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { useJobStore } from "~/stores/job-store";

export function useJobs(root: string | null) {
  return useQuery({
    queryKey: qk.jobs(root ?? ""),
    enabled: Boolean(root),
    queryFn: () => invoke<JobSummary[]>("list_jobs", { root: root!, limit: 15 }),
  });
}

export function useJobEvents(root: string | null, jobId: string | null) {
  return useQuery({
    queryKey: qk.jobEvents(root ?? "", jobId ?? ""),
    enabled: Boolean(root && jobId),
    queryFn: () =>
      invoke<JobEventRow[]>("get_job_events", { root: root!, jobId: jobId! }),
  });
}

export function usePlanUpdate(root: string | null) {
  return useQuery({
    queryKey: qk.planUpdate(root ?? ""),
    enabled: Boolean(root),
    queryFn: () => invoke<UpdatePlan>("plan_update", { root: root! }),
  });
}

export function useStartUpdateMutation(root: string | null) {
  const queryClient = useQueryClient();
  const start = useJobStore((s) => s.start);
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      invoke<string>("start_update", { root: root!, ...input }),
    onSuccess: (jobId) => {
      start(jobId, { isUpdate: true });
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.jobs(root) });
      }
    },
  });
}

export function useCancelUpdateMutation() {
  return useMutation({
    mutationFn: () => invoke("cancel_update"),
  });
}

export function useStartEmbedJobMutation(root: string | null) {
  const queryClient = useQueryClient();
  const start = useJobStore((s) => s.start);
  return useMutation({
    mutationFn: (input?: { force?: boolean }) =>
      invoke<string>("start_embed_job", { root: root!, force: input?.force ?? false }),
    onSuccess: (jobId) => {
      start(jobId);
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.jobs(root) });
      }
    },
  });
}

export function useTestWorkerConnectionMutation() {
  return useMutation({
    mutationFn: (worker: Record<string, unknown>) =>
      invoke<string>("test_worker_connection", { worker }),
  });
}
