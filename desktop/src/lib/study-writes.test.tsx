import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { PENDING_STUDY_WRITES_KEY } from "~/domain/study-writes";
import {
  resetStudyWriteQueueForTests,
  useEnqueueStudyWrite,
  useStudyWriteStatus,
} from "~/lib/study-writes";
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

describe("study writes", () => {
  afterEach(() => {
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
});
