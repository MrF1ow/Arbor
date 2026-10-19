import type { PendingSource, Selection } from "~/domain/types";

export function formatRanges(ranges: [number, number][]): string {
  return ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}-${end}`))
    .join(", ");
}

export function parseRanges(raw: string, pageCount: number): [number, number][] | null {
  const text = raw.trim();
  if (text === "") return null;
  const ranges: [number, number][] = [];
  for (const part of text.split(",")) {
    const bit = part.trim();
    const match = bit.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`Invalid range "${bit}". Use 3-5 or 8.`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Range ${start}-${end} is outside 1-${pageCount}.`);
    }
    ranges.push([start, end]);
  }
  return ranges;
}

export function alignmentNote(p: PendingSource): string | null {
  if (p.alignment_status === "ambiguous") {
    return "Alignment is uncertain. Set ranges or leave blank for the whole file.";
  }
  if (p.alignment_status === "changed" && p.suggested_ranges.length === 0) {
    return "Pages were removed. Leave blank to skip, or set ranges to ingest.";
  }
  return null;
}

export function selectionsFromPending(pending: PendingSource[]): Selection[] {
  return pending.map((p) => ({
    path: p.path,
    ranges: p.suggested_ranges.length > 0 ? p.suggested_ranges : null,
  }));
}

export function selectionsFromRangeValues(
  pending: PendingSource[],
  rangeValues: Record<string, string>,
): Selection[] {
  return pending.map((p) => ({
    path: p.path,
    ranges: parseRanges(rangeValues[p.path] ?? "", p.page_count),
  }));
}

export function validateRangeValue(
  raw: string,
  pageCount: number,
): string | null {
  try {
    parseRanges(raw, pageCount);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function validateRangeValues(
  pending: PendingSource[],
  rangeValues: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const p of pending) {
    try {
      parseRanges(rangeValues[p.path] ?? "", p.page_count);
    } catch (error) {
      errors[p.path] = error instanceof Error ? error.message : String(error);
    }
  }
  return errors;
}
