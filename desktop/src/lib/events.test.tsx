import { QueryClient } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { onJobFinished } from "~/lib/job-finished";
import {
  getSuppressWatchUntilForTests,
  handleFilesChanged,
  handleWatchTriggered,
  handleWorkerProgressSideEffects,
  invalidateAfterJobFinished,
  resetSuppressWatchForTests,
  suppressWatch,
} from "~/lib/events";
import { qk } from "~/lib/queries/keys";
import { formatWorkerEvent } from "~/domain/worker-events";
import { useJobStore } from "~/stores/job-store";
import { useSyncUiStore } from "~/stores/sync-ui-store";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";
import { renderWithProviders } from "~/test/render";

async function waitForWorkerEventsBridge() {
  await waitFor(async () => {
    await emit("arbor://progress", {
      line: JSON.stringify({ type: "warning", message: "bridge-ready" }),
    });
    expect(useJobStore.getState().lines.some((l) => l.includes("bridge-ready"))).toBe(true);
  });
}

describe("events", () => {
  beforeEach(() => {
    resetSuppressWatchForTests();
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      lines: [],
      unread: 0,
    });
    useUpdatePlanStore.setState({ pending: null, open: false });
    useSyncUiStore.setState({ syncConflictOpen: false });
  });

  afterEach(() => {
    clearMocks();
  });

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
    expect(spy).toHaveBeenCalledWith({
      queryKey: qk.studyPlan("/mock/a", "cell-biology"),
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

  it("invalidates library keys after suppress window", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    suppressWatch(0);
    handleFilesChanged(client, FIXTURE_ROOT_FALL, FIXTURE_ROOT_FALL);
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.library(FIXTURE_ROOT_FALL) });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["courseOverview", FIXTURE_ROOT_FALL] });
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

  it("WorkerEventsBridge invokes start_study_job on auto-quiz after job-finished", async () => {
    clearMockIpcLog();
    useUiStore.setState({
      lastCourse: { root: FIXTURE_ROOT_FALL, course: "cell-biology" },
    });
    useJobStore.setState({ activeUpdateJobId: "update-1" });
    renderWithProviders(<></>, {
      fixtures: {
        get_knowledge_settings: () => ({
          delete_sources_after_digest: false,
          auto_update: true,
          auto_embed: false,
          watch_enabled: true,
          auto_generate: { flashcards: false, quiz: true },
          sync_after_commit: false,
        }),
      },
    });
    await waitForWorkerEventsBridge();
    clearMockIpcLog();
    await emit("arbor://job-finished", {
      job_id: "update-1",
      status: "succeeded",
      summary: null,
      operation: "update",
      root: FIXTURE_ROOT_FALL,
    });
    await waitFor(() =>
      expect(getMockIpcLog().filter((c) => c === "start_study_job").length).toBeGreaterThan(0),
    );
  });

  it("WorkerEventsBridge runs watch plan_update and start_update", async () => {
    clearMockIpcLog();
    renderWithProviders(<></>, {
      fixtures: {
        plan_update: () => ({
          pending: [
            {
              path: "/tmp/lecture.pdf",
              course: "cell-biology",
              source_type: "pdf",
              page_count: 10,
              suggested_ranges: [[1, 10]],
              alignment_status: "clean_append",
              previously_digested: false,
            },
          ],
        }),
      },
    });
    await waitForWorkerEventsBridge();
    clearMockIpcLog();
    await emit("arbor://files-changed", { root: FIXTURE_ROOT_FALL });
    await waitFor(() => expect(getMockIpcLog()).toContain("plan_update"));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_update"));
  });

  it("handleWatchTriggered stores pending plan when auto_update is false", async () => {
    const client = new QueryClient();
    const pending = [
      {
        path: "/tmp/a.pdf",
        course: "cell-biology",
        source_type: "pdf",
        page_count: 1,
        suggested_ranges: [] as [number, number][],
        alignment_status: "clean_append" as const,
        previously_digested: false,
      },
    ];
    await handleWatchTriggered(FIXTURE_ROOT_FALL, FIXTURE_ROOT_FALL, {
      queryClient: client,
      getKnowledgeSettings: async () => ({
        ...{
          delete_sources_after_digest: false,
          auto_embed: false,
          watch_enabled: true,
          auto_generate: { flashcards: false, quiz: false },
          sync_after_commit: false,
        },
        auto_update: false,
      }),
      planUpdate: async () => ({ pending }),
      startUpdate: async () => "job",
      checkAuth: async () => ({ authenticated: true }),
      setPendingPlan: (p, open) => useUpdatePlanStore.getState().setPendingPlan(p, open),
      providerId: "grok",
      modelId: "grok-4.7",
    });
    expect(useUpdatePlanStore.getState().open).toBe(true);
    expect(useUpdatePlanStore.getState().pending).toEqual(pending);
  });

  it("progress side effects reload library on committed", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    handleWorkerProgressSideEffects(
      client,
      { type: "committed", commit: "abc", courses: ["cell-biology"] },
      { root: FIXTURE_ROOT_FALL, course: "cell-biology", providerLabel: "Grok" },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.library(FIXTURE_ROOT_FALL) });
  });

  it("progress sync_conflict opens sync dialog flag", () => {
    const client = new QueryClient();
    handleWorkerProgressSideEffects(
      client,
      { type: "sync_conflict", message: "conflict" },
      { root: FIXTURE_ROOT_FALL, course: null, providerLabel: "Grok" },
    );
    expect(useSyncUiStore.getState().syncConflictOpen).toBe(true);
  });
});
