import { useQueries } from "@tanstack/react-query";

import { mergeToday, type TodayPayload, type TodayResult, type TodaySummary } from "~/domain/today";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";

/** A library's `study_today` stays fresh for a minute; grades, quiz answers and finished jobs invalidate it. */
const TODAY_STALE_MS = 60_000;

export type TodayAll = {
  /** Merged over every library that has answered so far; undefined until the first one does. */
  summary: TodaySummary | undefined;
  /** Libraries still waiting on their first answer: a slow one never blocks the others. */
  pending: string[];
  isLoading: boolean;
};

/**
 * `study_today` for every library in `knowledge_roots`, in parallel (Q7), merged with `mergeToday`.
 * A library whose call fails is listed in `summary.errors`; the others still show.
 */
export function useTodayAll(): TodayAll {
  const settings = useSettings();
  const roots = (settings.data?.knowledge_roots ?? []).map((entry) => entry.path);
  return useQueries({
    queries: roots.map((root) => ({
      queryKey: qk.todayRoot(root),
      staleTime: TODAY_STALE_MS,
      retry: false,
      queryFn: () => invoke<TodayPayload>("study_today", { root }),
    })),
    combine: (results): TodayAll => {
      const answered: TodayResult[] = [];
      const pending: string[] = [];
      results.forEach((result, index) => {
        const root = roots[index]!;
        if (result.data) {
          answered.push({ root, payload: result.data });
        } else if (result.error) {
          answered.push({ root, error: result.error.message });
        } else {
          pending.push(root);
        }
      });
      return {
        summary: answered.length > 0 ? mergeToday(answered) : undefined,
        pending,
        isLoading: settings.isLoading || (roots.length > 0 && answered.length === 0),
      };
    },
  });
}
