import { describe, expect, it } from "vitest";

import { formatWorkerEvent } from "~/domain/worker-events";
import type { WorkerEvent } from "~/domain/types";

const EVENT_CASES: WorkerEvent[] = [
  { type: "run_started", model_id: "m1" },
  { type: "nothing_to_process" },
  { type: "course_started", course_dir: "cell-biology", sources: 2 },
  { type: "source_started", source: "a.pdf", ranges: [[1, 3]] },
  { type: "source_done", digest: "d1" },
  { type: "source_failed", source: "a.pdf", message: "fail" },
  { type: "source_deleted", source: "a.pdf" },
  { type: "course_synthesis_started", digest_count: 2 },
  { type: "course_synthesis_done" },
  { type: "course_synthesis_failed", message: "nope" },
  { type: "course_done", course_dir: "cell-biology", digests: 1 },
  { type: "embed_started" },
  { type: "embed_done", embedded: 1, chunks: 2, skipped: 0 },
  { type: "embed_failed", message: "embed fail" },
  { type: "stage", stage: "digest", status: "running", detail: "x" },
  { type: "warning", message: "warn" },
  { type: "cancelled" },
  { type: "committed", commit: "abc", courses: ["cell-biology"] },
  { type: "sync_done", action: "pull", commit: "abc" },
  { type: "run_done", processed: 1, failed: 0, skipped: 0 },
  { type: "auth_failed", reason: "no key" },
  { type: "error", message: "err" },
  { type: "skill_started", skill: "flashcards" },
  { type: "skill_progress", skill: "flashcards", attempt: 1, attempts: 3, message: "retry" },
  { type: "skill_done", skill: "flashcards", file: "flashcards.json" },
  { type: "skill_failed", skill: "flashcards", message: "bad" },
  { type: "skill_stale_skipped", skill: "flashcards" },
  { type: "citation_failed", path: "citations.json", id: "c1", reason: "bad cite" },
  { type: "sync_conflict", message: "conflict" },
  { type: "worker_exit" },
  { type: "custom_unknown", message: "hello" } as WorkerEvent,
];

describe("formatWorkerEvent", () => {
  it("formats stage events with step metadata", () => {
    const formatted = formatWorkerEvent({
      type: "stage",
      stage: "digest",
      status: "running",
      detail: "page 3",
    });
    expect(formatted.line).toContain("digest: running");
    expect(formatted.step).toBe("digest");
    expect(formatted.status).toBe("running");
  });

  it("marks failures", () => {
    const formatted = formatWorkerEvent({ type: "error", message: "boom" });
    expect(formatted.status).toBe("failed");
  });

  it("covers every renderEvent case from legacy", () => {
    for (const ev of EVENT_CASES) {
      const formatted = formatWorkerEvent(ev, "Grok");
      expect(formatted.line.length).toBeGreaterThan(0);
    }
    const authLine = formatWorkerEvent({ type: "auth_failed", reason: "x" }, "Grok").line;
    expect(authLine).toContain("Grok is not authenticated");
  });
});
