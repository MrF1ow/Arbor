import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  useStartFlashcardJobMutation,
  useStartQuizJobMutation,
  useStartStudyJobMutation,
} from "~/lib/queries/jobs";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderWithProviders } from "~/test/render";

const ROOT = "/mock/knowledge/fall-2026";
const DIGESTS = ["cell-biology/digests/2026-09-12-membranes.md"];

function mount(calls: unknown[]) {
  return renderWithProviders(<></>, {
    minimal: true,
    fixtures: {
      start_study_job: (args) => {
        calls.push(args);
        return "job-1";
      },
    },
  });
}

describe("study job scope", () => {
  afterEach(() => clearTauriMocks());

  it("flashcards pass digests through to start_study_job", async () => {
    const calls: unknown[] = [];
    const { Wrapper } = mount(calls);
    const { result } = renderHook(() => useStartFlashcardJobMutation(ROOT), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        course: "cell-biology",
        force: false,
        model: "m",
        provider: "grok",
        digests: DIGESTS,
      });
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ skill: "flashcards", course: "cell-biology", digests: DIGESTS });
    expect(calls[0]).not.toHaveProperty("fromText");
  });

  it("quiz passes fromText and digests, and an unscoped run sends neither", async () => {
    const calls: unknown[] = [];
    const { Wrapper } = mount(calls);
    const { result } = renderHook(() => useStartQuizJobMutation(ROOT), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        course: "cell-biology",
        force: false,
        model: "m",
        provider: "grok",
        digests: DIGESTS,
        fromText: "Osmosis moves water toward higher solute.",
      });
      await result.current.mutateAsync({
        course: "cell-biology",
        force: true,
        model: "m",
        provider: "grok",
      });
    });
    expect(calls[0]).toMatchObject({
      skill: "quiz",
      digests: DIGESTS,
      fromText: "Osmosis moves water toward higher solute.",
    });
    expect(calls[1]).not.toHaveProperty("digests");
    expect(calls[1]).not.toHaveProperty("fromText");
  });

  it("the generic study job mutation forwards whatever scope it is given", async () => {
    const calls: unknown[] = [];
    const { Wrapper } = mount(calls);
    const { result } = renderHook(() => useStartStudyJobMutation(ROOT), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        root: ROOT,
        course: "cell-biology",
        skill: "flashcards",
        digests: DIGESTS,
      });
    });
    expect(calls[0]).toMatchObject({ digests: DIGESTS });
  });
});
