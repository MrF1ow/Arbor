import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { TodayPayload } from "~/domain/today";
import { useTodayAll } from "~/lib/queries/today";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED } from "~/test/fixtures/data";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderWithProviders } from "~/test/render";

function payload(course: string, due: string[]): TodayPayload {
  return {
    courses: [
      {
        course,
        digest_count: 3,
        due_ids: due,
        deck_count: due.length,
        mastered: 0,
        mastery: null,
        exam_date: null,
        days_to_exam: null,
        plan: null,
      },
    ],
    weak_topics: [],
    quiz_accuracy: {
      this_week: { correct: 1, total: 2 },
      last_week: { correct: 0, total: 0 },
    },
    next_exam: null,
  };
}

function mount(fixtures: Parameters<typeof renderWithProviders>[1] extends infer O ? O extends { fixtures?: infer F } ? F : never : never) {
  const { Wrapper, queryClient } = renderWithProviders(<></>, { minimal: true, fixtures });
  const hook = renderHook(() => useTodayAll(), { wrapper: Wrapper });
  return { ...hook, queryClient };
}

describe("useTodayAll", () => {
  afterEach(() => clearTauriMocks());

  it("calls study_today once per library and merges the answers", async () => {
    const calls: string[] = [];
    const { result } = mount({
      study_today: (args) => {
        const root = String((args as { root: string }).root);
        calls.push(root);
        return root === FIXTURE_ROOT_FALL ? payload("cell-biology", ["a", "b"]) : payload("collab-notes", ["c"]);
      },
    });
    await waitFor(() => expect(result.current.summary?.courses).toHaveLength(2));
    expect(calls.sort()).toEqual([FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED].sort());
    expect(result.current.summary?.courses.map((c) => [c.root, c.due_ids.length])).toEqual([
      [FIXTURE_ROOT_FALL, 2],
      [FIXTURE_ROOT_SHARED, 1],
    ]);
    expect(result.current.summary?.quiz_accuracy.this_week).toEqual({ correct: 2, total: 4 });
    expect(result.current.pending).toEqual([]);
  });

  it("does not let a slow library block the others", async () => {
    const { result } = mount({
      study_today: (args) => {
        const root = String((args as { root: string }).root);
        if (root === FIXTURE_ROOT_SHARED) {
          return new Promise(() => undefined); // never answers
        }
        return payload("cell-biology", ["a"]);
      },
    });
    await waitFor(() => expect(result.current.summary?.courses).toHaveLength(1));
    expect(result.current.summary?.courses[0]!.root).toBe(FIXTURE_ROOT_FALL);
    expect(result.current.pending).toEqual([FIXTURE_ROOT_SHARED]);
  });

  it("lists a failing library in errors and still shows the others", async () => {
    const { result } = mount({
      study_today: (args) => {
        const root = String((args as { root: string }).root);
        if (root === FIXTURE_ROOT_SHARED) {
          throw new Error("worker server exited");
        }
        return payload("cell-biology", ["a"]);
      },
    });
    await waitFor(() => expect(result.current.summary?.errors).toHaveLength(1), { timeout: 5000 });
    expect(result.current.summary?.errors[0]).toEqual({
      root: FIXTURE_ROOT_SHARED,
      message: "worker server exited",
    });
    expect(result.current.summary?.courses).toHaveLength(1);
  });
});
