import { describe, expect, it } from "vitest";

import { JOB_START_LABEL, runningJobStatusLabel } from "~/domain/job-labels";

describe("runningJobStatusLabel", () => {
  it("prefers step over label", () => {
    expect(runningJobStatusLabel("Indexing", JOB_START_LABEL.update)).toBe("Indexing");
  });

  it("falls back to label then Running…", () => {
    expect(runningJobStatusLabel(null, JOB_START_LABEL.quiz)).toBe(JOB_START_LABEL.quiz);
    expect(runningJobStatusLabel(null, null)).toBe("Running…");
  });
});
