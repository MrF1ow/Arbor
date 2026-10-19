import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { onJobFinished } from "~/lib/job-finished";
import {
  getSuppressWatchUntilForTests,
  handleFilesChanged,
  invalidateAfterJobFinished,
  suppressWatch,
} from "~/lib/events";
import { qk } from "~/lib/queries/keys";
import { formatWorkerEvent } from "~/domain/worker-events";
import { useJobStore } from "~/stores/job-store";

describe("events", () => {
  it("formats progress payloads for the job store", () => {
    const formatted = formatWorkerEvent({ type: "run_started", model_id: "grok-4.7" });
    expect(formatted.line).toContain("Run started");
  });

  it("invalidates expected keys after job finished", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateAfterJobFinished(client, "/mock/a", "cell-biology");
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.jobs("/mock/a") });
    expect(spy).toHaveBeenCalledWith({
      queryKey: qk.courseOverview("/mock/a", "cell-biology"),
    });
  });

  it("respects suppressWatch window for files-changed", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    suppressWatch(5000);
    handleFilesChanged(client, "/mock/a", "/mock/a");
    expect(spy).not.toHaveBeenCalled();
    expect(getSuppressWatchUntilForTests()).toBeGreaterThan(Date.now());
  });

  it("chains auto-quiz and auto-embed via onJobFinished", async () => {
    const startFlashcards = vi.fn();
    const startQuiz = vi.fn();
    const startEmbed = vi.fn();
    await onJobFinished(
      {
        job_id: "update-1",
        status: "succeeded",
        summary: null,
        operation: "update",
        root: "/mock/a",
      },
      {
        activeUpdateJobId: "update-1",
        currentCourse: "cell-biology",
        activeRoot: "/mock/a",
        getKnowledgeSettings: async () => ({
          delete_sources_after_digest: false,
          auto_update: true,
          auto_embed: true,
          watch_enabled: true,
          auto_generate: { flashcards: false, quiz: true },
          sync_after_commit: false,
        }),
        invalidateAfterJob: () => {},
        startFlashcardsJob: startFlashcards,
        startQuizJob: startQuiz,
        startEmbedJob: startEmbed,
      },
      { pendingAutoEmbed: false, pendingAutoQuiz: false },
    );
    expect(startQuiz).toHaveBeenCalled();
    expect(startEmbed).not.toHaveBeenCalled();
  });

  it("appends formatted progress lines to the job store", () => {
    useJobStore.setState({ lines: [], unread: 0 });
    const formatted = formatWorkerEvent({ type: "warning", message: "disk slow" });
    useJobStore.getState().append(formatted.line);
    expect(useJobStore.getState().lines.join("\n")).toContain("disk slow");
  });
});
