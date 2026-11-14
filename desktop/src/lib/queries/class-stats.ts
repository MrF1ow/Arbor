import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DigestStatsRow } from "~/domain/lectures";
import type { CourseStats, StudyPlanStatus } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { scheduleTodayRefresh } from "~/lib/study-writes";

/** Per-lecture card and quiz counts for the lecture column, keyed by `digests/x.md`. */
export function useDigestStats(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.digestStats(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: async () => {
      const payload = await invoke<{ digests: Record<string, DigestStatsRow> }>("study_progress", {
        root: root!,
        course: course!,
        action: "digest-stats",
      });
      return payload.digests;
    },
  });
}

/** Quiz and card accuracy by week for one class. */
export function useCourseStats(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.courseStats(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<CourseStats>("study_progress", { root: root!, course: course!, action: "stats" }),
  });
}

export function useStudyPlanStatus(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.studyPlanStatus(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<StudyPlanStatus>("study_plan_status", { root: root!, course: course! }),
  });
}

/** Tick or untick a plan task. Works for viewers of a shared library too (PR 138). */
export function useStudyPlanToggle(root: string | null, course: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { task: string; done: boolean }) =>
      invoke<StudyPlanStatus>("study_plan_toggle", {
        root: root!,
        course: course!,
        task: input.task,
        done: input.done,
      }),
    onSuccess: () => {
      if (root && course) {
        void queryClient.invalidateQueries({ queryKey: qk.studyPlanStatus(root, course) });
        scheduleTodayRefresh(queryClient, root);
      }
    },
  });
}
