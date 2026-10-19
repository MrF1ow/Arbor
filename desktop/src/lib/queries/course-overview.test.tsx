import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { createAppQueryClient } from "~/lib/query-client";
import { qk } from "~/lib/queries/keys";
import { useCourseOverview } from "~/lib/queries/notes";
import { onJobFinished } from "~/lib/job-finished";
import { createStudyWriteQueue } from "~/domain/study-writes";
import { installMockIpc } from "~/test/mock-ipc";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";

describe("useCourseOverview", () => {
  afterEach(() => {
    clearMocks();
  });

  it("calls study_progress overview once per root and course", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useCourseOverview("/mock/a", "cell-biology"), { wrapper });
    renderHook(() => useCourseOverview("/mock/a", "cell-biology"), { wrapper });
    await waitFor(() =>
      expect(
        getMockIpcLog().filter(
          (c) => c === "study_progress",
        ).length,
      ).toBe(1),
    );
  });

  it("invalidates after study write onSent", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useCourseOverview("/mock/a", "cell-biology"), { wrapper });
    await waitFor(() => expect(getMockIpcLog().includes("study_progress")).toBe(true));
    clearMockIpcLog();
    invalidateSpy.mockClear();

    const queue = createStudyWriteQueue({
      send: async () => {},
      storage: window.localStorage,
      onStatus: () => {},
      onSent: (w) => {
        void client.invalidateQueries({ queryKey: qk.courseOverview(w.root, w.course) });
      },
    });
    queue.enqueue({
      key: "grade",
      writeId: "w1",
      root: "/mock/a",
      course: "cell-biology",
      args: { action: "grade" },
    });
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: qk.courseOverview("/mock/a", "cell-biology"),
      }),
    );
  });

  it("invalidates on job-finished handling", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    await onJobFinished(
      {
        job_id: "j1",
        status: "failed",
        summary: null,
        operation: "update",
        root: "/mock/a",
      },
      {
        activeUpdateJobId: null,
        currentCourse: "cell-biology",
        activeRoot: "/mock/a",
        getKnowledgeSettings: async () => ({
          delete_sources_after_digest: false,
          auto_update: true,
          auto_embed: false,
          watch_enabled: true,
          auto_generate: { flashcards: false, quiz: false },
          sync_after_commit: false,
        }),
        invalidateAfterJob: (root, course) => {
          if (course) {
            void client.invalidateQueries({ queryKey: qk.courseOverview(root, course) });
          }
        },
        startFlashcardsJob: async () => {},
        startQuizJob: async () => {},
        startEmbedJob: async () => {},
      },
      { pendingAutoEmbed: false, pendingAutoQuiz: false },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: qk.courseOverview("/mock/a", "cell-biology"),
    });
  });
});
