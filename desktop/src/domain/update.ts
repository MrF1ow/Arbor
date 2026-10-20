import type { PendingSource, Selection } from "~/domain/types";

export function selectionsFromPending(pending: PendingSource[]): Selection[] {
  return pending.map((p) => ({
    path: p.path,
    ranges: p.suggested_ranges.length > 0 ? p.suggested_ranges : null,
  }));
}
