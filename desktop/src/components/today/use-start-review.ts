import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { reviewOrder } from "~/components/today/today-model";
import type { TodayCourse, TodayPayload } from "~/domain/today";
import { invoke } from "~/lib/ipc";
import { useOpenClass } from "~/lib/open-class";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { flushStudyWrites } from "~/lib/study-writes";
import { scopedSessionKey } from "~/components/study/study-scope";
import { classScopeKey, useLectureSelectionStore } from "~/stores/lecture-selection-store";
import { useStudySessionStore } from "~/stores/study-session-store";

/**
 * Start review (Q15, Q27): open Practice > Cards of the class with the nearest exam that has cards due.
 *
 * Grades refresh Today only after a 2 s per-library debounce, so the counts on screen can be stale:
 * a class just reviewed would still look due (Start review would open an empty deck) and a class
 * that just became due would look empty. So the choice is made on fresh data: queued grades are
 * flushed, every library is refetched in parallel (this also updates Today), and the order is
 * computed over the fresh rows.
 */
export function useStartReview(courses: TodayCourse[]) {
  const queryClient = useQueryClient();
  const openClass = useOpenClass();
  const settings = useSettings();
  const [starting, setStarting] = useState(false);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      await flushStudyWrites().catch(() => undefined);
      const roots = new Set([
        ...(settings.data?.knowledge_roots ?? []).map((entry) => entry.path),
        ...courses.map((c) => c.root),
      ]);
      const fresh = await Promise.all(
        [...roots].map(async (root): Promise<TodayCourse[]> => {
          try {
            const payload = await queryClient.fetchQuery({
              queryKey: qk.todayRoot(root),
              queryFn: () => invoke<TodayPayload>("study_today", { root }),
              staleTime: 0,
            });
            return payload.courses.map((row) => ({ ...row, root }));
          } catch {
            // A library that cannot answer keeps the counts already on screen.
            return courses.filter((c) => c.root === root);
          }
        }),
      );
      const [next] = reviewOrder(fresh.flat());
      if (next) {
        // Review means the class's whole due deck: drop lectures ticked there earlier.
        useLectureSelectionStore.getState().clear(classScopeKey(next.root, next.course));
        // ...and its saved Cards session: Cards restores the deck mode and position it was left
        // in (Full deck, mid-deck), but Review counted the due cards and starts at the first.
        useStudySessionStore.getState().clear(scopedSessionKey(next.root, next.course, "flashcards", []));
        await openClass(next.root, next.course, "cards");
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setStarting(false);
    }
  }, [courses, openClass, queryClient, settings.data]);

  return { start, starting };
}
