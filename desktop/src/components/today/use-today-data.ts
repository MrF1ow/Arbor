import { useQueries } from "@tanstack/react-query";

import type { CourseMetaMap } from "~/domain/course-icons";
import type { ReadingEntry } from "~/domain/lectures";
import type { TodayCourse } from "~/domain/today";
import type { DigestInfo } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { continueReading, type ContinueItem } from "~/components/today/today-model";

/** Each library's class colours, by library path. Shares the sidebar's `courseMeta` cache. */
export function useCourseMetaByRoot(roots: string[]): Record<string, CourseMetaMap | undefined> {
  return useQueries({
    queries: roots.map((root) => ({
      queryKey: qk.courseMeta(root),
      queryFn: () => invoke<CourseMetaMap>("read_course_meta", { root }),
    })),
    combine: (results) => Object.fromEntries(roots.map((root, i) => [root, results[i]?.data])),
  });
}

/**
 * The lectures to pick up again, across every library: reading state per library and the digest
 * list per class (both shared with the class views' caches). Whatever has loaded shows at once.
 */
export function useContinueReading(courses: TodayCourse[]): { items: ContinueItem[]; isLoading: boolean } {
  const withDigests = courses.filter((c) => c.digest_count > 0);
  const roots = [...new Set(withDigests.map((c) => c.root))];
  const reading = useQueries({
    queries: roots.map((root) => ({
      queryKey: qk.readingState(root),
      queryFn: () => invoke<Record<string, ReadingEntry>>("read_reading_state", { root }),
    })),
  });
  const digests = useQueries({
    queries: withDigests.map((c) => ({
      queryKey: qk.digests(c.root, c.course),
      queryFn: () => invoke<DigestInfo[]>("list_digests", { root: c.root, course: c.course }),
    })),
  });

  const readingByRoot = new Map(roots.map((root, i) => [root, reading[i]?.data]));
  const sources = withDigests.flatMap((c, i) => {
    const list = digests[i]?.data;
    const state = readingByRoot.get(c.root);
    // A class waits for both answers; reading its digests as all "New" before the state arrives would flash wrong rows.
    return list && state ? [{ root: c.root, course: c.course, digests: list, reading: state }] : [];
  });
  return {
    items: continueReading(sources),
    isLoading: withDigests.length > 0 && sources.length === 0 && (reading.some((q) => q.isPending) || digests.some((q) => q.isPending)),
  };
}
