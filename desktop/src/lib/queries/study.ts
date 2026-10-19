import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useStudyJson(root: string | null, course: string | null, file: string) {
  return useQuery({
    queryKey: qk.studyJson(root ?? "", course ?? "", file),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<unknown>("read_study_json", { root: root!, course: course!, file }),
  });
}

export function useQuizProgress(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.quizProgress(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<unknown>("read_quiz_progress", { root: root!, course: course! }),
  });
}

export function useStudyPlan(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.studyPlan(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<string>("read_markdown", {
        root: root!,
        relativePath: `${course}/study-plan.md`,
      }),
  });
}

export function useStudyArtifactStale(
  root: string | null,
  course: string | null,
  skill: string,
) {
  return useQuery({
    queryKey: qk.studyArtifactStale(root ?? "", course ?? "", skill),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<boolean>("study_artifact_stale", { root: root!, course: course!, skill }),
  });
}

export function useAppendCardMutation(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      invoke<{ id: string }>("append_card", {
        root: root!,
        course: course!,
        ...input,
      }),
    onSuccess: () => {
      if (root && course) {
        void queryClient.invalidateQueries({
          queryKey: qk.studyJson(root, course, "flashcards.json"),
        });
        void queryClient.invalidateQueries({ queryKey: qk.courseOverview(root, course) });
      }
    },
  });
}

export function useStudyPlanMutation(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      invoke("study_plan", { root: root!, course: course!, ...input }),
    onSuccess: () => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.studyPlan(root, course) });
      }
    },
  });
}
