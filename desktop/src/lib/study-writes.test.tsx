import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { PENDING_STUDY_WRITES_KEY } from "~/domain/study-writes";
import {
  resetStudyWriteQueueForTests,
  useEnqueueStudyWrite,
  useStudyWriteStatus,
} from "~/lib/study-writes";
import { qk } from "~/lib/queries/keys";
import { useTodayAll } from "~/lib/queries/today";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { useStudyWritesStore } from "~/stores/study-writes-store";
import { renderWithProviders } from "~/test/render";
import { toast } from "sonner";

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: { ...actual.toast, error: vi.fn() },
  };
});

function StudyWriteProbe() {
  useStudyWriteStatus();
  return null;
}

/** Observes `study_today` for every library, as the always-mounted sidebar does. */
function TodayProbe() {
  useStudyWriteStatus();
  useTodayAll();
  return null;
}

const designTodayEmpty = {
  courses: [],
  weak_topics: [],
  quiz_accuracy: { this_week: { correct: 0, total: 0 }, last_week: { correct: 0, total: 0 } },
  next_exam: null,
};

describe("study writes", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearTauriMocks();
    resetStudyWriteQueueForTests();
    window.localStorage.removeItem(PENDING_STUDY_WRITES_KEY);
  });

  it("enqueue returns immediately while IPC is pending", async () => {
    let resolveSend: (() => void) | undefined;
    const { Wrapper } = renderWithProviders(<StudyWriteProbe />, {
      minimal: true,
      fixtures: {
        study_progress: () =>
          new Promise<void>((resolve) => {
            resolveSend = resolve;
          }),
      },
    });
    const { result } = renderHook(() => useEnqueueStudyWrite(), { wrapper: Wrapper });
    result.current({
      key: "grade",
      root: "/mock/a",
      course: "cell-biology",
      args: { action: "grade", card_id: "c1" },
    });
    await waitFor(() => expect(useStudyWritesStore.getState().pending).toBe(1));
    resolveSend?.();
  });

  it("retries transient failures", async () => {
    let attempts = 0;
    vi.useFakeTimers();
    const { Wrapper } = renderWithProviders(<StudyWriteProbe />, {
      minimal: true,
      fixtures: {
        study_progress: () => {
          attempts += 1;
          if (attempts < 2) {
            throw new Error("worker server exited");
          }
          return {};
        },
      },
    });
    const { result } = renderHook(() => useEnqueueStudyWrite(), { wrapper: Wrapper });
    result.current({
      key: "grade",
      root: "/mock/a",
      course: "cell-biology",
      args: { action: "grade" },
    });
    await vi.advanceTimersByTimeAsync(1100);
    expect(attempts).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it("persists and replays pending writes once with double mount", async () => {
    window.localStorage.setItem(
      PENDING_STUDY_WRITES_KEY,
      JSON.stringify([
        {
          key: "grade",
          writeId: "stored-1",
          root: "/mock/a",
          course: "cell-biology",
          args: { action: "grade" },
        },
      ]),
    );
    const calls: unknown[] = [];
    const ui = <StudyWriteProbe />;
    const first = renderWithProviders(ui, {
      minimal: true,
      fixtures: {
        study_progress: (args) => {
          calls.push(args);
          return {};
        },
      },
    });
    await waitFor(() => expect(calls.length).toBe(1), { timeout: 3000 });
    first.unmount();
    renderWithProviders(ui, {
      minimal: true,
      fixtures: {
        study_progress: (args) => {
          calls.push(args);
          return {};
        },
      },
    });
    await waitFor(() => expect(calls.length).toBe(1));
  });

  it("shows a toast when a write is dropped", async () => {
    vi.useFakeTimers();
    const { Wrapper } = renderWithProviders(<StudyWriteProbe />, {
      minimal: true,
      fixtures: {
        study_progress: () => {
          throw new Error("permanent failure");
        },
      },
    });
    const { result } = renderHook(() => useEnqueueStudyWrite(), { wrapper: Wrapper });
    result.current({
      key: "grade",
      root: "/mock/a",
      course: "cell-biology",
      args: { action: "grade" },
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(toast.error).toHaveBeenCalledWith(`A grade couldn't be saved: permanent failure`);
    vi.useRealTimers();
  });

  it("a sent grade refreshes Today, the lecture badges, the class stats and the due count", async () => {
    const { Wrapper, queryClient } = renderWithProviders(<StudyWriteProbe />, {
      minimal: true,
      fixtures: { study_progress: () => ({}) },
    });
    const seed = (key: readonly unknown[]) => queryClient.setQueryData(key, { stale: false });
    const keys = {
      todayMine: qk.todayRoot("/mock/a"),
      todayOther: qk.todayRoot("/mock/b"),
      digestStats: qk.digestStats("/mock/a", "cell-biology"),
      courseStats: qk.courseStats("/mock/a", "cell-biology"),
      overview: qk.courseOverview("/mock/a", "cell-biology"),
      otherClass: qk.digestStats("/mock/a", "genetics"),
    };
    Object.values(keys).forEach(seed);

    const { result } = renderHook(() => useEnqueueStudyWrite(), { wrapper: Wrapper });
    result.current({
      key: "grade",
      root: "/mock/a",
      course: "cell-biology",
      args: { action: "grade", card_id: "c1" },
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(keys.digestStats)?.isInvalidated).toBe(true);
    });
    // Today is coalesced: it is marked once the burst has been quiet for a moment.
    await waitFor(() => expect(queryClient.getQueryState(keys.todayMine)?.isInvalidated).toBe(true), {
      timeout: 4000,
    });
    // Only the library that was written to has its Today marked; the others are untouched.
    expect(queryClient.getQueryState(keys.todayOther)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(keys.digestStats)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(keys.courseStats)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(keys.overview)?.isInvalidated).toBe(true);
    // A different class's badges are untouched.
    expect(queryClient.getQueryState(keys.otherClass)?.isInvalidated).toBe(false);
  });
  it("a burst of grades refetches study_today once, for the written library only", async () => {
    vi.useFakeTimers();
    const { Wrapper } = renderWithProviders(<TodayProbe />, {
      minimal: true,
      fixtures: { study_progress: () => ({}), study_today: () => designTodayEmpty },
    });
    const { result } = renderHook(() => useEnqueueStudyWrite(), { wrapper: Wrapper });
    await vi.advanceTimersByTimeAsync(100);
    const todayCalls = () =>
      getMockIpcCalls().filter((c) => c.cmd === "study_today").map((c) => (c.args as { root: string }).root);
    expect(todayCalls().sort()).toEqual([FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED].sort());
    clearMockIpcLog();

    for (let i = 0; i < 5; i += 1) {
      result.current({
        key: "grade",
        root: FIXTURE_ROOT_FALL,
        course: "cell-biology",
        args: { action: "grade", card_id: `c${i}` },
      });
      await vi.advanceTimersByTimeAsync(300);
    }
    // Still inside the quiet window: nothing yet.
    expect(todayCalls()).toEqual([]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(todayCalls()).toEqual([FIXTURE_ROOT_FALL]);
  });
});
