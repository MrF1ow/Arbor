import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { reviewOrder } from "~/components/today/today-model";
import type { TodayCourse, TodayPayload } from "~/domain/today";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { flushStudyWrites } from "~/lib/study-writes";

export type NextReviewClass = { root: string; course: string; due: number };

/**
 * The class to review after this one (Q15): the first of Start review's order (nearest exam, then
 * most due) that is not the class just finished. Grades refresh Today only after a 2 s debounce,
 * so the cached counts can be stale: queued grades are flushed and every library is refetched
 * before choosing, exactly as Start review does. The current class is excluded either way, since a
 * scoped session can end while the class still has cards due outside the scope.
 *
 * Runs only while `enabled` (the due deck is done); returns null until it has an answer.
 */
export function useNextReviewClass(root: string | null, course: string, enabled: boolean): NextReviewClass | null {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [found, setFound] = useState<{ key: string; next: NextReviewClass | null } | null>(null);
  const roots = (settings.data?.knowledge_roots ?? []).map((entry) => entry.path).join("\n");
  const key = `${root ?? ""}|${course}`;

  useEffect(() => {
    if (!enabled || !root) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await flushStudyWrites().catch(() => undefined);
      const fresh = await Promise.all(
        roots
          .split("\n")
          .filter(Boolean)
          .map(async (library): Promise<TodayCourse[]> => {
            try {
              const payload = await queryClient.fetchQuery({
                queryKey: qk.todayRoot(library),
                queryFn: () => invoke<TodayPayload>("study_today", { root: library }),
                staleTime: 0,
              });
              return payload.courses.map((row) => ({ ...row, root: library }));
            } catch {
              return []; // a library that cannot answer offers nothing
            }
          }),
      );
      if (cancelled) {
        return;
      }
      const [next] = reviewOrder(fresh.flat().filter((c) => !(c.root === root && c.course === course)));
      setFound({ key, next: next ? { root: next.root, course: next.course, due: next.due_ids.length } : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, root, course, roots, key, queryClient]);

  return enabled && found?.key === key ? found.next : null;
}
