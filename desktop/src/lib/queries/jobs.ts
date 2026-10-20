import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { citationJobArgs } from "~/domain/citations";
import { conceptJobArgs, diagramJobArgs } from "~/domain/concepts";
import { flashcardJobArgs } from "~/domain/flashcards";
import { quizJobArgs } from "~/domain/quiz";
import type { JobEventRow, JobSummary, UpdatePlan } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { useJobStore } from "~/stores/job-store";

type StudyJobInput = {
  course: string;
  force: boolean;
  model: string;
  provider: string;
};

function afterStudyJobStarted(
  queryClient: QueryClient,
  root: string | null,
  jobId: string,
) {
  useJobStore.getState().start(jobId);
  if (root) {
    void queryClient.invalidateQueries({ queryKey: qk.jobs(root) });
  }
}

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

export function usePlanUpdateMutation(root: string | null) {
  return useMutation({
    mutationFn: () => invoke<UpdatePlan>("plan_update", { root: root! }),
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

export function useStartStudyJobMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: Record<string, unknown>) =>
      invoke<string>("start_study_job", args),
    onSuccess: (jobId) => afterStudyJobStarted(queryClient, root, jobId),
  });
}

export function useStartFlashcardJobMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StudyJobInput) =>
      invoke<string>(
        "start_study_job",
        flashcardJobArgs(root!, input.course, input.force, input.model, input.provider),
      ),
    onSuccess: (jobId) => afterStudyJobStarted(queryClient, root, jobId),
  });
}

export function useStartQuizJobMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StudyJobInput) =>
      invoke<string>(
        "start_study_job",
        quizJobArgs(root!, input.course, input.force, input.model, input.provider),
      ),
    onSuccess: (jobId) => afterStudyJobStarted(queryClient, root, jobId),
  });
}

export function useStartConceptJobMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StudyJobInput) =>
      invoke<string>(
        "start_study_job",
        conceptJobArgs(root!, input.course, input.force, input.model, input.provider),
      ),
    onSuccess: (jobId) => afterStudyJobStarted(queryClient, root, jobId),
  });
}

export function useStartDiagramJobMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StudyJobInput) =>
      invoke<string>(
        "start_study_job",
        diagramJobArgs(root!, input.course, input.force, input.model, input.provider),
      ),
    onSuccess: (jobId) => afterStudyJobStarted(queryClient, root, jobId),
  });
}

export function useStartCitationJobMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StudyJobInput) =>
      invoke<string>(
        "start_study_job",
        citationJobArgs(root!, input.course, input.force, input.model, input.provider),
      ),
    onSuccess: (jobId) => afterStudyJobStarted(queryClient, root, jobId),
  });
}

export function useTestWorkerConnectionMutation() {
  return useMutation({
    mutationFn: (worker: Record<string, unknown>) =>
      invoke<string>("test_worker_connection", { worker }),
  });
}
