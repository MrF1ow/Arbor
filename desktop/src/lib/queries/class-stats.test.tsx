import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  useCourseStats,
  useDigestStats,
  useStudyPlanStatus,
  useStudyPlanToggle,
} from "~/lib/queries/class-stats";
import { useUsageSummary } from "~/lib/queries/usage";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderWithProviders } from "~/test/render";

const ROOT = "/mock/knowledge/fall-2026";

describe("class stats queries", () => {
  afterEach(() => clearTauriMocks());

  it("digest stats and course stats call study_progress with their action", async () => {
    const calls: unknown[] = [];
    const { Wrapper } = renderWithProviders(<></>, {
      minimal: true,
      fixtures: {
        study_progress: (args) => {
          calls.push(args);
          return (args as { action: string }).action === "digest-stats"
            ? { digests: { "digests/a.md": { cards: 1 } } }
            : { quiz: { this_week: { correct: 1, total: 2 }, last_week: { correct: 0, total: 0 } } };
        },
      },
    });
    const digests = renderHook(() => useDigestStats(ROOT, "Bio"), { wrapper: Wrapper });
    const stats = renderHook(() => useCourseStats(ROOT, "Bio"), { wrapper: Wrapper });
    await waitFor(() => expect(digests.result.current.data).toBeDefined());
    await waitFor(() => expect(stats.result.current.data).toBeDefined());
    expect(calls).toContainEqual({ root: ROOT, course: "Bio", action: "digest-stats" });
    expect(calls).toContainEqual({ root: ROOT, course: "Bio", action: "stats" });
    expect(digests.result.current.data?.["digests/a.md"]?.cards).toBe(1);
  });

  it("plan status reads and a toggle sends the task id and refreshes the status", async () => {
    let done = false;
    const toggles: unknown[] = [];
    const { Wrapper } = renderWithProviders(<></>, {
      minimal: true,
      fixtures: {
        study_plan_status: () => ({
          done: done ? 1 : 0,
          total: 1,
          tasks: [{ id: "0a1b2c3d4e", text: "Review", done }],
        }),
        study_plan_toggle: (args) => {
          toggles.push(args);
          done = true;
          return {};
        },
      },
    });
    const status = renderHook(() => useStudyPlanStatus(ROOT, "Bio"), { wrapper: Wrapper });
    const toggle = renderHook(() => useStudyPlanToggle(ROOT, "Bio"), { wrapper: Wrapper });
    await waitFor(() => expect(status.result.current.data?.done).toBe(0));
    await act(async () => {
      await toggle.result.current.mutateAsync({ task: "0a1b2c3d4e", done: true });
    });
    expect(toggles).toEqual([{ root: ROOT, course: "Bio", task: "0a1b2c3d4e", done: true }]);
    await waitFor(() => expect(status.result.current.data?.done).toBe(1));
  });

  it("usage summary passes the day window", async () => {
    const calls: unknown[] = [];
    const { Wrapper } = renderWithProviders(<></>, {
      minimal: true,
      fixtures: {
        usage_summary: (args) => {
          calls.push(args);
          return [{ provider: "grok", requests: 4, input_tokens: 10, output_tokens: 5, tokens_known: 4 }];
        },
      },
    });
    const { result } = renderHook(() => useUsageSummary(ROOT, 7), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(calls).toEqual([{ root: ROOT, days: 7 }]);
  });
});
