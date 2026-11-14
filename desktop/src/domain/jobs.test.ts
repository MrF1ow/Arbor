import { describe, expect, it } from "vitest";

import { formatDuration, jobKindLabel, jobScopeLabel, relativeTime } from "~/domain/jobs";

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

  it("formats minutes and seconds", () => {
    expect(formatDuration("2026-10-20T11:00:00Z", "2026-10-20T11:02:14Z")).toBe("2m 14s");
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
