import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { fixtureCourseOverview } from "~/test/fixtures/data";
import { qk } from "~/lib/queries/keys";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { renderAppAtRoute } from "~/test/render";

function readStudyFile(payload: unknown): string {
  return String((payload as Record<string, unknown>).file ?? "");
}

function readStudyCourse(payload: unknown): string {
  return String((payload as Record<string, unknown>).course ?? "");
}

function studyProgressAction(payload: unknown): string {
  return String((payload as Record<string, unknown>).action ?? "");
}

const smallDeck = {
  schema_version: 1 as const,
  course: "cell-biology",
  cards: [
    {
      id: "fc-1",
      front: "Question one",
      back: "Answer one",
      tags: ["tag-a"],
      source: {
        digest: "digests/2026-09-12-membranes.md",
        heading: "Membrane structure",
        page: "12",
      },
    },
    {
      id: "fc-2",
      front: "Question two",
      back: "Answer two",
      tags: [],
      source: { digest: "2026-09-12-membranes", heading: null, page: null },
    },
    {
      id: "fc-99",
      front: "Question ninety-nine",
      back: "Answer ninety-nine",
      tags: [],
      source: { digest: "2026-09-12-membranes", heading: null, page: null },
    },
  ],
};

async function waitForFlashcardsReady() {
  await waitFor(
    () => {
      expect(screen.getByTestId("flashcards-view")).toBeInTheDocument();
      expect(screen.getByText(/Due today · 2/i)).toBeInTheDocument();
    },
    { timeout: 8000 },
  );
}

describe("flashcards PR8", { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: true,
      logOpen: false,
      logHeight: 200,
      notesIndexOpen: true,
      lastCourse: null,
    });
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
    });
    clearMockIpcLog();
  });

  afterEach(() => {
    cleanup();
    resetMockHandlerTimers();
    clearMocks();
    vi.restoreAllMocks();
  });

  it("optimistically advances after mastered grade while study_progress is pending", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      study_progress: (args) => {
        if (studyProgressAction(args) === "overview") {
          return fixtureCourseOverview;
        }
        if (studyProgressAction(args) === "grade") {
          return new Promise(() => {});
        }
        return {};
      },
    });
    await waitForFlashcardsReady();
    expect(screen.getByText("Question one")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.keyboard("3");
    await waitFor(() => {
      expect(screen.getByText("Question two")).toBeInTheDocument();
    });
    const gradeCall = getMockIpcCalls().find(
      (c) =>
        c.cmd === "study_progress" &&
        (c.args as { action?: string }).action === "grade",
    );
    expect(gradeCall?.args).toMatchObject({
      action: "grade",
      id: "fc-1",
      result: "mastered",
      digest: "digests/2026-09-12-membranes.md",
      heading: "Membrane structure",
    });
    expect((gradeCall?.args as { writeId?: string }).writeId).toBeTruthy();
  });

  it("due again requeues and mastered drops due count", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      study_progress: (args) => {
        if (studyProgressAction(args) === "overview") {
          return {
            ...fixtureCourseOverview,
            due: { due_ids: ["fc-1"], count: 1, deck_count: 3 },
          };
        }
        return {};
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/Due today · 1/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.click(screen.getByRole("button", { name: /^Mastered/i }));
    await waitFor(() => {
      expect(screen.getByText("No cards due today.")).toBeInTheDocument();
    });
    expect(screen.getByText(/Due today · 0/i)).toBeInTheDocument();
  });

  it("full deck wrong advances to the next card", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(screen.getByText(/Full deck · 86/i));
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.click(screen.getByRole("button", { name: /^Wrong/i }));
    await waitFor(() => {
      expect(screen.getByText("Question two")).toBeInTheDocument();
    });
  });

  it("toggles deck mode and rebuilds the session", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    await user.click(screen.getByText(/Full deck · 86/i));
    await waitFor(() => {
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
    });
  });

  it("handles keyboard flip, grade gating, navigation, and input ignore", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.keyboard("1");
    expect(screen.getByText("Question one")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.getByText("Answer one")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Question two")).toBeInTheDocument();
    await user.keyboard("1");
    expect(screen.getByText("Question two")).toBeInTheDocument();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await user.keyboard(" ");
    expect(screen.queryByText("Answer two")).not.toBeInTheDocument();
    input.remove();
  });

  it("focuses ?card= and clears the search param", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/flashcards?card=fc-99", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      study_progress: (args) => {
        if (studyProgressAction(args) === "overview") {
          return {
            ...fixtureCourseOverview,
            due: { due_ids: ["fc-1"], count: 1, deck_count: 3 },
          };
        }
        return {};
      },
    });
    await waitFor(() => {
      expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(router.state.location.searchStr).not.toContain("card=");
    });
    expect(user).toBeDefined();
  });

  it("navigates source chip to digest with heading", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(
      screen.getByRole("button", {
        name: /digests\/2026-09-12-membranes\.md · Membrane structure · p\. 12/i,
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
      expect(router.state.location.searchStr).toContain("heading=Membrane+structure");
    });
  });

  it("shows unverified badge from citations fixture", async () => {
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        if (readStudyFile(payload) === "citations.json") {
          return {
            schema_version: 1,
            course: "cell-biology",
            failures: [
              {
                path: "study/flashcards.json",
                id: "fc-1",
                reason: "No matching digest span",
              },
            ],
          };
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });

  it("shows stale badge when artifact is stale", async () => {
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      study_artifact_stale: () => true,
    });
    await waitForFlashcardsReady();
    expect(screen.getByText(/Digests updated since last generation/i)).toBeInTheDocument();
  });

  it("shows unsaved badge and retries flush on click", async () => {
    let gradeCalls = 0;
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      study_progress: (args) => {
        if (studyProgressAction(args) === "overview") {
          return fixtureCourseOverview;
        }
        if (studyProgressAction(args) === "grade") {
          gradeCalls += 1;
          throw new Error("worker server exited");
        }
        return {};
      },
    });
    const user = userEvent.setup();
    await waitForFlashcardsReady();
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.click(screen.getByRole("button", { name: /^Mastered/i }));
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /1 unsaved · Retry/i })).toBeInTheDocument();
      },
      { timeout: 12000 },
    );
    const callsBeforeRetry = gradeCalls;
    await user.click(screen.getByRole("button", { name: /1 unsaved · Retry/i }));
    await waitFor(() => expect(gradeCalls).toBeGreaterThan(callsBeforeRetry), {
      timeout: 10000,
    });
  });

  it("shows empty deck copy and generate gates", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(
          screen.getByText(
            /No flashcards yet for Cell Biology\. Generate a deck from your digests\./,
          ),
        ).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => {
      expect(getMockIpcLog()).toContain("start_study_job");
    });
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect(call?.args).toMatchObject({
      course: "cell-biology",
      skill: "flashcards",
      force: false,
    });
  });

  it("generate when signed out logs auth message without starting job", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      check_auth: () => ({
        authenticated: false,
        reason: "Sign in required",
        docs_url: "https://example.com/docs",
      }),
    });
    await waitFor(
      () => {
        expect(
          screen.getByText(
            /No flashcards yet for Cell Biology\. Generate a deck from your digests\./,
          ),
        ).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => {
      expect(useJobStore.getState().lines.join("\n")).toMatch(/not authenticated/i);
    });
    expect(getMockIpcLog()).not.toContain("start_study_job");
    expect(useUiStore.getState().logOpen).toBe(false);
  });

  it("refresh from digests uses force true", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Refresh from digests/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((call?.args as { force?: boolean }).force).toBe(true);
  });

  it("disables generate for viewer libraries", async () => {
    await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      library_show: () => ({
        present: true,
        name: "Shared",
        created_by: "a@example.com",
        members: [],
        provider: null,
        role: "viewer",
      }),
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /^Generate$/i })).toBeDisabled();
      },
      { timeout: 8000 },
    );
  });

  it("does not reset card index when deck data refetches with same ids", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/flashcards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Question two")).toBeInTheDocument();
    const refreshed = {
      ...smallDeck,
      cards: smallDeck.cards.map((c) =>
        c.id === "fc-2" ? { ...c, back: "Answer two refreshed" } : c,
      ),
    };
    queryClient.setQueryData(qk.studyJson(FIXTURE_ROOT_FALL, "cell-biology", "flashcards.json"), refreshed);
    await waitFor(() => {
      expect(screen.getByText("Question two")).toBeInTheDocument();
    });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });
});
