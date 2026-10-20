import { describe, expect, it } from "vitest";

import { formatDuration, jobKindLabel, relativeTime } from "~/domain/jobs";

const NOW = new Date("2026-10-20T12:00:00Z").getTime();

describe("jobKindLabel", () => {
  it("maps known trigger kinds", () => {
    expect(jobKindLabel("manual")).toBe("Manual update");
    expect(jobKindLabel("watch")).toBe("Folder watch");
    expect(jobKindLabel("flashcards")).toBe("Flashcards");
    expect(jobKindLabel("embed")).toBe("Embeddings");
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
