import { useQuery } from "@tanstack/react-query";

import type { CourseOverviewPayload } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useMarkdown(root: string | null, relativePath: string | null) {
  return useQuery({
    queryKey: qk.markdown(root ?? "", relativePath ?? ""),
    enabled: Boolean(root && relativePath),
    queryFn: () =>
      invoke<string>("read_markdown", { root: root!, relativePath: relativePath! }),
  });
}

export function useCourseOverview(root: string | null, course: string | null) {
  return useQuery({
    queryKey: qk.courseOverview(root ?? "", course ?? ""),
    enabled: Boolean(root && course),
    queryFn: () =>
      invoke<CourseOverviewPayload>("study_progress", {
        root: root!,
        course: course!,
        action: "overview",
      }),
  });
}
