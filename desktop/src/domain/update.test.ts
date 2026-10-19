import { describe, expect, it } from "vitest";

import type { PendingSource } from "~/domain/types";
import {
  alignmentNote,
  formatRanges,
  parseRanges,
  selectionsFromRangeValues,
  validateRangeValues,
} from "~/domain/update";

describe("update range helpers", () => {
  it("formatRanges renders singles and spans", () => {
    expect(formatRanges([[3, 3], [5, 8]])).toBe("3, 5-8");
  });

  it("parseRanges accepts blank as null", () => {
    expect(parseRanges("", 10)).toBeNull();
    expect(parseRanges("  ", 10)).toBeNull();
  });

  it("parseRanges accepts valid singles and ranges", () => {
    expect(parseRanges("8", 10)).toEqual([[8, 8]]);
    expect(parseRanges("3-5, 8", 10)).toEqual([
      [3, 5],
      [8, 8],
    ]);
  });

  it("parseRanges rejects garbage with legacy message", () => {
    expect(() => parseRanges("abc", 10)).toThrow('Invalid range "abc". Use 3-5 or 8.');
  });

  it("parseRanges rejects out-of-bounds with legacy message", () => {
    expect(() => parseRanges("0-5", 10)).toThrow("Range 0-5 is outside 1-10.");
    expect(() => parseRanges("5-11", 10)).toThrow("Range 5-11 is outside 1-10.");
  });

  it("alignmentNote matches legacy hints", () => {
    const ambiguous: PendingSource = {
      path: "a.pdf",
      course: "c",
      source_type: "pdf",
      page_count: 10,
      suggested_ranges: [],
      alignment_status: "ambiguous",
      previously_digested: false,
    };
    expect(alignmentNote(ambiguous)).toBe(
      "Alignment is uncertain. Set ranges or leave blank for the whole file.",
    );
    const changed: PendingSource = {
      ...ambiguous,
      alignment_status: "changed",
    };
    expect(alignmentNote(changed)).toBe(
      "Pages were removed. Leave blank to skip, or set ranges to ingest.",
    );
  });

  it("selectionsFromRangeValues uses null ranges for blank input", () => {
    const pending: PendingSource[] = [
      {
        path: "/tmp/a.pdf",
        course: "bio",
        source_type: "pdf",
        page_count: 20,
        suggested_ranges: [[1, 5]],
        alignment_status: "clean_append",
        previously_digested: false,
      },
    ];
    expect(selectionsFromRangeValues(pending, { "/tmp/a.pdf": "" })).toEqual([
      { path: "/tmp/a.pdf", ranges: null },
    ]);
  });

  it("validateRangeValues collects field errors", () => {
    const pending: PendingSource[] = [
      {
        path: "/tmp/a.pdf",
        course: "bio",
        source_type: "pdf",
        page_count: 5,
        suggested_ranges: [],
        alignment_status: "clean_append",
        previously_digested: false,
      },
    ];
    const errors = validateRangeValues(pending, { "/tmp/a.pdf": "9" });
    expect(errors["/tmp/a.pdf"]).toBe("Range 9-9 is outside 1-5.");
  });
});
