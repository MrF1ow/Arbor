import { useMemo } from "react";

import { buildLectureRows, type ReadingEntry, type UnitRows } from "~/domain/lectures";
import type { DigestInfo } from "~/domain/types";
import { useDigestStats } from "~/lib/queries/class-stats";
import { useDigests } from "~/lib/queries/library";
import { useReadingState } from "~/lib/queries/reading-state";

const NO_READING: Record<string, ReadingEntry> = {};

/** The lecture column's rows for a class: digests, per-lecture stats and reading state joined (I5). */
export function useLectureRows(root: string | null, course: string) {
  const digests = useDigests(root, course);
  const stats = useDigestStats(root, course);
  const reading = useReadingState(root);

  const rows = useMemo<UnitRows[]>(
    () => buildLectureRows(course, digests.data ?? [], stats.data ?? {}, reading.data ?? NO_READING),
    [course, digests.data, stats.data, reading.data],
  );

  return {
    rows,
    digests: digests.data as DigestInfo[] | undefined,
    reading: reading.data ?? NO_READING,
    loading: digests.isLoading,
  };
}
