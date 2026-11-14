import { describe, expect, it } from "vitest";

import {
  formatDuration,
  jobKindLabel,
  jobScopeLabel,
  jobStartedLabel,
  jobStatusCounts,
  jobTitle,
  relativeTime,
} from "~/domain/jobs";

const NOW = new Date("2026-10-20T12:00:00Z").getTime();

describe("jobKindLabel", () => {
  it("maps trigger kinds without skill", () => {
    expect(jobKindLabel("manual")).toBe("Manual update");
    expect(jobKindLabel("watch")).toBe("Folder watch");
  });

  it("maps study skills via skill field", () => {
    expect(jobKindLabel("study", "flashcards")).toBe("Flashcards");
    expect(jobKindLabel("study", "quiz")).toBe("Quiz");
    expect(jobKindLabel("study", "concepts")).toBe("Concepts");
    expect(jobKindLabel("study", "diagrams")).toBe("Diagrams");
    expect(jobKindLabel("study", "citations")).toBe("Citations");
  });

  it("maps embed skill on manual jobs", () => {
    expect(jobKindLabel("manual", "embed")).toBe("Embeddings");
  });

  it("title-cases unknown kinds", () => {
    expect(jobKindLabel("custom_batch")).toBe("Custom Batch");
  });
});

describe("relativeTime", () => {
  it("formats minutes ago", () => {
    expect(relativeTime("2026-10-20T11:55:00Z", NOW)).toBe("5 min ago");
  });

  it("handles just now", () => {
    expect(relativeTime("2026-10-20T11:59:30Z", NOW)).toBe("just now");
  });
});

describe("formatDuration", () => {
  it("returns running when unfinished", () => {
    expect(formatDuration("2026-10-20T11:00:00Z", null)).toBe("running");
  });

  it("shows whole minutes in the design's short form", () => {
    expect(formatDuration("2026-10-20T11:00:00Z", "2026-10-20T11:01:00Z")).toBe("1 min");
    expect(formatDuration("2026-10-20T11:00:00Z", "2026-10-20T11:07:00Z")).toBe("7 min");
    expect(formatDuration("2026-10-20T11:00:00Z", "2026-10-20T11:02:14Z")).toBe("2 min");
  });

  it("shows seconds under a minute", () => {
    expect(formatDuration("2026-10-20T11:00:00Z", "2026-10-20T11:00:45Z")).toBe("45s");
  });
});

describe("jobScopeLabel", () => {
  const units = {
    "Cell Biology": [
      { path: "Cell Biology/digests/a.md", unit: "Unit 2" },
      { path: "Cell Biology/digests/b.md", unit: "Unit 2" },
      { path: "Cell Biology/digests/c.md", unit: "Unit 2" },
      { path: "Cell Biology/digests/d.md", unit: "Unit 1" },
    ],
  };

  it("names class, unit and count when every lecture shares a unit", () => {
    expect(
      jobScopeLabel(
        {
          course: "Cell Biology",
          digests: ["Cell Biology/digests/a.md", "Cell Biology/digests/b.md", "Cell Biology/digests/c.md"],
        },
        units,
      ),
    ).toBe("Cell Biology · Unit 2 · 3 lectures");
  });

  it("drops the unit when the lectures span units", () => {
    expect(
      jobScopeLabel(
        { course: "Cell Biology", digests: ["Cell Biology/digests/a.md", "Cell Biology/digests/d.md"] },
        units,
      ),
    ).toBe("Cell Biology · 2 lectures");
  });

  it("shows the class alone for a whole-class run and a single lecture count for one", () => {
    expect(jobScopeLabel({ course: "Cell Biology", digests: null }, units)).toBe("Cell Biology");
    expect(
      jobScopeLabel({ course: "Cell Biology", digests: ["Cell Biology/digests/d.md"] }, units),
    ).toBe("Cell Biology · Unit 1 · 1 lecture");
  });

  it("shows the class alone for a remote full run, whose plan lists every digest of the class", () => {
    const everyDigest = units["Cell Biology"].map((d) => d.path);
    expect(jobScopeLabel({ course: "Cell Biology", digests: everyDigest }, units)).toBe("Cell Biology");
    expect(jobScopeLabel({ course: "Cell Biology", digests: [...everyDigest].reverse() }, units)).toBe(
      "Cell Biology",
    );
    // A digest since deleted from the class does not turn a full run into a partial one.
    expect(
      jobScopeLabel({ course: "Cell Biology", digests: [...everyDigest, "Cell Biology/digests/gone.md"] }, units),
    ).toBe("Cell Biology");
  });

  it("keeps the count for a run that covers most but not all of a class", () => {
    expect(
      jobScopeLabel(
        {
          course: "Cell Biology",
          digests: ["Cell Biology/digests/a.md", "Cell Biology/digests/b.md", "Cell Biology/digests/c.md"],
        },
        units,
      ),
    ).toBe("Cell Biology · Unit 2 · 3 lectures");
  });

  it("is a dash for legacy rows and mixed-class updates", () => {
    expect(jobScopeLabel({ course: null, digests: null }, units)).toBe("—");
    expect(jobScopeLabel({ course: null, digests: ["A/x.pdf", "B/y.pdf"] }, units)).toBe("—");
  });

  it("falls back to a count when the units are unknown", () => {
    expect(
      jobScopeLabel({ course: "Genetics", digests: ["Genetics/digests/z.md"] }, units),
    ).toBe("Genetics · 1 lecture");
  });
});

describe("jobTitle", () => {
  it("names jobs as the Jobs table does", () => {
    expect(jobTitle("manual", null)).toBe("Update knowledge");
    expect(jobTitle("watch", null)).toBe("Update knowledge");
    expect(jobTitle("study", "flashcards")).toBe("Generate flashcards");
    expect(jobTitle("study", "quiz")).toBe("Generate quiz");
    expect(jobTitle("study", "concepts")).toBe("Concept map");
    expect(jobTitle("study", "diagrams")).toBe("Generate diagrams");
    expect(jobTitle("study", "citations")).toBe("Check citations");
    expect(jobTitle("manual", "embed")).toBe("Build embeddings");
  });

  it("falls back to the kind label for jobs it does not know", () => {
    expect(jobTitle("custom_batch", null)).toBe("Custom Batch");
  });
});

describe("jobStartedLabel", () => {
  const now = new Date(2026, 9, 20, 15, 30).getTime();

  it("shows the time of day for a job started today", () => {
    const label = jobStartedLabel(new Date(2026, 9, 20, 14, 41).toISOString(), now);
    expect(label).toMatch(/^2:41\s(?:PM|pm)$/);
  });

  it("says Yesterday for the previous calendar day, even a few hours earlier", () => {
    expect(jobStartedLabel(new Date(2026, 9, 19, 23, 50).toISOString(), now)).toBe("Yesterday");
    expect(jobStartedLabel(new Date(2026, 9, 19, 0, 5).toISOString(), now)).toBe("Yesterday");
  });

  it("shows the date for older jobs and echoes unparseable input", () => {
    expect(jobStartedLabel(new Date(2026, 9, 3, 9, 0).toISOString(), now)).toBe("Oct 3");
    expect(jobStartedLabel("not a date", now)).toBe("not a date");
  });
});

describe("jobStatusCounts", () => {
  it("counts each status the chips filter by, with every job under All", () => {
    const jobs = ["running", "failed", "succeeded", "succeeded", "cancelled"].map((status) => ({ status }));
    expect(jobStatusCounts(jobs)).toEqual({ all: 5, running: 1, failed: 1, succeeded: 2 });
  });
});
