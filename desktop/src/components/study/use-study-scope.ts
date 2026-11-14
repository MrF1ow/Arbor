import { useCallback, useMemo } from "react";

import { toCourseDigest } from "~/domain/lectures";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { classScopeKey, useLectureSelectionStore, useTickedLectures } from "~/stores/lecture-selection-store";

/**
 * The lectures ticked in the class column, which scope Practice and Map (I6). The scope comes from
 * the selection store, kept to lectures that still exist in the class: a ticked path no lecture
 * shows (deleted or renamed since) has no chip or tray to clear it, so it must not scope anything.
 * Until the lecture list loads the stored scope stands. "Studying … ×" and `clear` empty it.
 */
export function useStudyScope(course: string) {
  const settings = useSettings();
  const root = pickActiveRoot(settings.data);
  const stored = useTickedLectures(root, course);
  const lectures = useDigests(root, course).data;
  const digests = useMemo(() => {
    if (!lectures) {
      return stored;
    }
    const known = new Set(lectures.map((lecture) => toCourseDigest(course, lecture.path)));
    const kept = stored.filter((path) => known.has(path));
    return kept.length === stored.length ? stored : kept;
  }, [course, lectures, stored]);
  const clearKey = useLectureSelectionStore((s) => s.clear);
  const clear = useCallback(() => {
    if (root) {
      clearKey(classScopeKey(root, course));
    }
  }, [clearKey, course, root]);
  return { root, digests, clear };
}
