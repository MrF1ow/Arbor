import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { citationJobArgs } from "~/domain/citations";
import { conceptJobArgs, diagramJobArgs } from "~/domain/concepts";
import { flashcardJobArgs } from "~/domain/flashcards";
import { JOB_START_LABEL } from "~/domain/job-labels";
import { quizJobArgs } from "~/domain/quiz";
import type { JobEventRow, JobSummary, SshWorker, UpdatePlan } from "~/domain/types";
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
  label?: string,
) {
  useJobStore.getState().start(jobId, label ? { label } : undefined);
  if (root) {
    void queryClient.invalidateQueries({ queryKey: qk.jobs(root) });
  }
}

export function useInitArborDb(root: string | null) {
  return useQuery({
    queryKey: qk.arborDb(root ?? ""),
    enabled: Boolean(root),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => invoke("init_arbor_db", { root: root! }),
  });
}

export function useJobs(root: string | null) {
  const dbReady = useInitArborDb(root);
  return useQuery({
    queryKey: qk.jobs(root ?? ""),
    enabled: Boolean(root) && dbReady.isSuccess,
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
      start(jobId, { isUpdate: true, label: JOB_START_LABEL.update });
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
      start(jobId, { label: JOB_START_LABEL.embed });
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
    onSuccess: (jobId, args) => {
      const skill = typeof args.skill === "string" ? args.skill : "";
      const labelBySkill: Record<string, string> = {
        flashcards: JOB_START_LABEL.flashcards,
        quiz: JOB_START_LABEL.quiz,
        concepts: JOB_START_LABEL.concepts,
        diagrams: JOB_START_LABEL.diagrams,
        citations: JOB_START_LABEL.citations,
      };
      afterStudyJobStarted(queryClient, root, jobId, labelBySkill[skill]);
    },
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
    onSuccess: (jobId) =>
      afterStudyJobStarted(queryClient, root, jobId, JOB_START_LABEL.flashcards),
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
    onSuccess: (jobId) => afterStudyJobStarted(queryClient, root, jobId, JOB_START_LABEL.quiz),
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
    onSuccess: (jobId) =>
      afterStudyJobStarted(queryClient, root, jobId, JOB_START_LABEL.concepts),
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
    onSuccess: (jobId) =>
      afterStudyJobStarted(queryClient, root, jobId, JOB_START_LABEL.diagrams),
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
    onSuccess: (jobId) =>
      afterStudyJobStarted(queryClient, root, jobId, JOB_START_LABEL.citations),
  });
}

export function useTestWorkerConnectionMutation() {
  return useMutation({
    mutationFn: (worker: SshWorker) => invoke<string>("test_worker_connection", { worker }),
  });
}
