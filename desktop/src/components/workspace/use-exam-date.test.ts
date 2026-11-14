import { describe, expect, it } from "vitest";

import { isCommittableExamDate } from "~/components/workspace/use-exam-date";

describe("isCommittableExamDate (F83)", () => {
  it.each(["2026-11-04", "1900-01-01", "2100-12-31", "2028-02-29"])("accepts %s", (value) => {
    expect(isCommittableExamDate(value)).toBe(true);
  });

  it.each([
    "",
    "0002-11-04",
    "0202-11-04",
    "1899-12-31",
    "2101-01-01",
    "12027-11-04",
    "2027-02-30",
    "2027-13-01",
    "2027-11",
    "27-11-04",
  ])("rejects %j", (value) => {
    expect(isCommittableExamDate(value)).toBe(false);
  });
});
