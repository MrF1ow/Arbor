import type { QueryClient } from "@tanstack/react-query";

import { qk } from "~/lib/queries/keys";

/** Mirrors legacy `reloadLibraryAfterSync` (main.ts ~2619–2624). */
export function reloadLibraryAfterSync(
  queryClient: QueryClient,
  root: string,
  course: string | null,
) {
  void queryClient.invalidateQueries({ queryKey: qk.library(root) });
  void queryClient.invalidateQueries({ queryKey: qk.courses(root) });
  void queryClient.invalidateQueries({ queryKey: ["digests", root] });
  void queryClient.invalidateQueries({ queryKey: ["markdown", root] });
  if (course) {
    void queryClient.invalidateQueries({ queryKey: qk.courseOverview(root, course) });
  } else {
    void queryClient.invalidateQueries({ queryKey: ["courseOverview", root] });
  }
  void queryClient.invalidateQueries({ queryKey: ["search", root] });
}
