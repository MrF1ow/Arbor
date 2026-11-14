import { describe, expect, it } from "vitest";

import { compactAgo, libraryStatus, type LibraryStatusInput } from "~/components/app/library-status";

const NOW = Date.parse("2026-11-14T12:00:00Z");

function input(overrides: Partial<LibraryStatusInput> = {}): LibraryStatusInput {
  return {
    desktop: true,
    hasRoot: true,
    jobStatus: "idle",
    step: null,
    label: null,
    progress: null,
    jobLibrary: null,
    lastFinishedJobId: null,
    latestJob: null,
    finishedElsewhere: false,
    nowMs: NOW,
    ...overrides,
  };
}

describe("compactAgo", () => {
  it("writes the design's short form", () => {
    expect(compactAgo("2026-11-14T11:59:40Z", NOW)).toBe("just now");
    expect(compactAgo("2026-11-14T11:15:00Z", NOW)).toBe("45m ago");
    expect(compactAgo("2026-11-14T10:00:00Z", NOW)).toBe("2h ago");
    expect(compactAgo("2026-11-11T12:00:00Z", NOW)).toBe("3d ago");
  });

  it("keeps an unreadable stamp as is", () => {
    expect(compactAgo("yesterday-ish", NOW)).toBe("yesterday-ish");
  });
});

describe("libraryStatus", () => {
  it("says Desktop app required outside the desktop app, whatever else is true", () => {
    expect(libraryStatus(input({ desktop: false, hasRoot: false }))).toEqual({
      variant: "none",
      label: "Desktop app required",
    });
  });

  it("says No Knowledge folder when no library is chosen", () => {
    expect(libraryStatus(input({ hasRoot: false }))).toEqual({
      variant: "none",
      label: "No Knowledge folder",
    });
  });

  it("shows the last successful job's age when idle", () => {
    const status = libraryStatus(
      input({
        latestJob: { id: "j1", status: "succeeded", started_at: "2026-11-14T09:00:00Z", finished_at: "2026-11-14T10:00:00Z" },
      }),
    );
    expect(status).toEqual({ variant: "idle", label: "Library up to date · 2h ago" });
  });

  it("says up to date without an age before any job ran", () => {
    expect(libraryStatus(input())).toEqual({ variant: "idle", label: "Library up to date" });
  });

  it("shows Updating N of M with the step while an update runs", () => {
    const status = libraryStatus(
      input({ jobStatus: "running", progress: { index: 2, total: 3 }, step: "Membrane transport" }),
    );
    expect(status).toEqual({ variant: "running", label: "Updating 2 of 3 · Membrane transport" });
  });

  it("counts from 1 before the first source starts", () => {
    const status = libraryStatus(input({ jobStatus: "running", progress: { index: 0, total: 3 } }));
    expect(status.label).toBe("Updating 1 of 3");
  });

  it("prefixes the library when the running job belongs to another one", () => {
    const status = libraryStatus(
      input({ jobStatus: "running", progress: { index: 2, total: 3 }, jobLibrary: "Study group" }),
    );
    expect(status.label).toBe("Study group · Updating 2 of 3");
  });

  it("prefixes the library on any running job of another one, with or without progress", () => {
    expect(
      libraryStatus(input({ jobStatus: "running", label: "Generating flashcards", jobLibrary: "Study group" })).label,
    ).toBe("Study group · Generating flashcards");
    expect(
      libraryStatus(
        input({ jobStatus: "running", step: "Writing questions", label: "Generating quiz", jobLibrary: "Study group" }),
      ).label,
    ).toBe("Study group · Writing questions");
    expect(libraryStatus(input({ jobStatus: "running", jobLibrary: "Study group" })).label).toBe(
      "Study group · Running…",
    );
  });

  it("keeps the active library's idle pill, with no job link, when another library's job failed", () => {
    expect(
      libraryStatus(
        input({
          jobStatus: "failed",
          finishedElsewhere: true,
          lastFinishedJobId: "job-other",
          lastFinishedJob: null,
        }),
      ),
    ).toEqual({ variant: "idle", label: "Library up to date" });
    const withHistory = libraryStatus(
      input({
        jobStatus: "failed",
        finishedElsewhere: true,
        lastFinishedJobId: "job-other",
        latestJob: { id: "j1", status: "succeeded", started_at: "2026-11-14T09:00:00Z", finished_at: "2026-11-14T10:00:00Z" },
      }),
    );
    expect(withHistory).toEqual({ variant: "idle", label: "Library up to date · 2h ago" });
    expect(withHistory.jobId).toBeUndefined();
  });

  it("falls back to the step or label for jobs without progress", () => {
    expect(libraryStatus(input({ jobStatus: "running", label: "Generating quiz" })).label).toBe("Generating quiz");
    expect(libraryStatus(input({ jobStatus: "running", step: "Writing questions", label: "Generating quiz" })).label).toBe(
      "Writing questions",
    );
  });

  it("shows a running job from the jobs list after a reload", () => {
    const status = libraryStatus(
      input({ latestJob: { id: "j2", status: "running", started_at: "2026-11-14T11:59:00Z", finished_at: null } }),
    );
    expect(status).toEqual({ variant: "running", label: "Job running", jobId: "j2" });
  });

  it("flags a failed update and links to it", () => {
    expect(
      libraryStatus(input({ jobStatus: "failed", lastFinishedJobId: "j9", lastFinishedJob: { skill: null } })),
    ).toEqual({ variant: "failed", label: "Last update failed", jobId: "j9" });
    const fromList = libraryStatus(
      input({ latestJob: { id: "j3", status: "failed", started_at: "2026-11-14T11:00:00Z", finished_at: null, skill: null } }),
    );
    expect(fromList).toEqual({ variant: "failed", label: "Last update failed", jobId: "j3" });
  });

  it("names the kind of a failed study job", () => {
    const fromList = libraryStatus(
      input({
        latestJob: { id: "j4", status: "failed", started_at: "2026-11-14T11:00:00Z", finished_at: null, skill: "citations" },
      }),
    );
    expect(fromList).toEqual({ variant: "failed", label: "Last citations job failed", jobId: "j4" });
    expect(
      libraryStatus(input({ jobStatus: "failed", lastFinishedJobId: "j5", lastFinishedJob: { skill: "quiz" } })).label,
    ).toBe("Last quiz job failed");
  });

  it("says Last job failed when the failed job's kind is not known", () => {
    expect(libraryStatus(input({ jobStatus: "failed", lastFinishedJobId: "j9" }))).toEqual({
      variant: "failed",
      label: "Last job failed",
      jobId: "j9",
    });
  });
  it("says Last job failed for a failed job of an unknown skill", () => {
    expect(
      libraryStatus(input({ jobStatus: "failed", lastFinishedJobId: "j6", lastFinishedJob: { skill: "fixture" } })).label,
    ).toBe("Last job failed");
  });
});
