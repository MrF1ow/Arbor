import { emit } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { qk } from "~/lib/queries/keys";
import { useCourseOverview } from "~/lib/queries/notes";
import { useEnqueueStudyWrite } from "~/lib/study-writes";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { getMockIpcLog } from "~/test/mock-handlers";
import { renderWithProviders } from "~/test/render";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";

async function waitForWorkerEventsBridge() {
  await waitFor(async () => {
    await emit("arbor://progress", {
      line: JSON.stringify({ type: "warning", message: "bridge-ready" }),
    });
    expect(useJobStore.getState().lines.some((l) => l.includes("bridge-ready"))).toBe(true);
  });
}

describe("useCourseOverview", () => {
  afterEach(() => {
    clearMocks();
  });

  it("calls study_progress overview once per root and course", async () => {
    const { Wrapper } = renderWithProviders(<></>, { minimal: true });
    renderHook(() => useCourseOverview("/mock/a", "cell-biology"), { wrapper: Wrapper });
    renderHook(() => useCourseOverview("/mock/a", "cell-biology"), { wrapper: Wrapper });
    await waitFor(() =>
      expect(getMockIpcLog().filter((c) => c === "study_progress").length).toBe(1),
    );
  });

  it("invalidates after study write through StudyWritesProvider", async () => {
    function EnqueueProbe() {
      useCourseOverview("/mock/a", "cell-biology");
      const enqueue = useEnqueueStudyWrite();
      enqueue({
        key: "grade",
        root: "/mock/a",
        course: "cell-biology",
        args: { action: "grade" },
      });
      return null;
    }
    const { queryClient } = renderWithProviders(<EnqueueProbe />, { minimal: true });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: qk.courseOverview("/mock/a", "cell-biology"),
      }),
    );
  });

  it("invalidates on job-finished via WorkerEventsBridge", async () => {
    useUiStore.setState({
      lastCourse: { root: FIXTURE_ROOT_FALL, course: "cell-biology" },
    });
    function OverviewProbe() {
      useCourseOverview(FIXTURE_ROOT_FALL, "cell-biology");
      return null;
    }
    const { queryClient } = renderWithProviders(<OverviewProbe />);
    await waitFor(() => expect(getMockIpcLog().includes("study_progress")).toBe(true));
    await waitForWorkerEventsBridge();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await emit("arbor://job-finished", {
      job_id: "j1",
      status: "failed",
      summary: null,
      operation: "update",
      root: FIXTURE_ROOT_FALL,
    });
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: qk.courseOverview(FIXTURE_ROOT_FALL, "cell-biology"),
      }),
    );
  });
});
