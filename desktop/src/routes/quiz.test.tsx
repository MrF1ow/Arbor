import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { fixtureSettings } from "~/test/fixtures/data";
import { qk } from "~/lib/queries/keys";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { studySessionKey } from "~/domain/study-session";
import { useJobStore } from "~/stores/job-store";
import { useStudySessionStore } from "~/stores/study-session-store";
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

const smallQuiz = {
  schema_version: 1 as const,
  course: "cell-biology",
  questions: [
    {
      id: "q-1",
      type: "multiple_choice" as const,
      prompt: "Quiz prompt one",
      choices: ["Alpha", "Beta", "Gamma", "Delta"],
      answer_index: 1,
      explanation: "Explanation one",
      source: {
        digest: "digests/2026-09-12-membranes.md",
        heading: "Membrane structure",
      },
    },
    {
      id: "q-2",
      type: "multiple_choice" as const,
      prompt: "Quiz prompt two",
      choices: ["One", "Two", "Three", "Four"],
      answer_index: 0,
      explanation: "Explanation two",
      source: { digest: "2026-09-12-membranes", heading: null },
    },
  ],
};

async function waitForQuizReady() {
  await waitFor(
    () => {
      expect(screen.getByTestId("quiz-view")).toBeInTheDocument();
      expect(screen.getByText("Quiz prompt one")).toBeInTheDocument();
      expect(screen.getByText(/Question 1 of 2/i)).toBeInTheDocument();
    },
    { timeout: 8000 },
  );
}

function trackEmptyStateText(pattern: RegExp): () => string[] {
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    const nodes = screen.queryAllByText(pattern);
    if (nodes.length > 0) {
      seen.push("empty");
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    return seen;
  };
}

describe("quiz PR9", { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useStudySessionStore.persist.clearStorage();
    useStudySessionStore.setState({ sessions: {} });
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
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("optimistically submits while study_progress is pending", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
      study_progress: (args) => {
        if (studyProgressAction(args) === "quiz") {
          return new Promise(() => {});
        }
        return {};
      },
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Beta/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await waitFor(() => {
      expect(screen.getByText("Explanation one")).toBeInTheDocument();
    });
    expect(screen.getByText("1 / 2 correct")).toBeInTheDocument();
    const quizCall = getMockIpcCalls().find(
      (c) =>
        c.cmd === "study_progress" && (c.args as { action?: string }).action === "quiz",
    );
    expect(quizCall?.args).toMatchObject({
      action: "quiz",
      id: "q-1",
      result: "correct",
      digest: "digests/2026-09-12-membranes.md",
      heading: "Membrane structure",
    });
    expect((quizCall?.args as { writeId?: string }).writeId).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    const quizCalls = getMockIpcCalls().filter(
      (c) =>
        c.cmd === "study_progress" && (c.args as { action?: string }).action === "quiz",
    );
    expect(quizCalls).toHaveLength(1);
    const cached = queryClient.getQueryData<Record<string, unknown>>(
      qk.quizProgress(FIXTURE_ROOT_FALL, "cell-biology"),
    );
    expect(cached?.["q-1"]).toMatchObject({ seen: 1, correct: 1, wrong: 0 });
  });

  it("sends empty heading when source heading is null", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
      study_progress: (args) => {
        if (studyProgressAction(args) === "quiz") {
          return new Promise(() => {});
        }
        return {};
      },
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /^One/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    const quizCall = getMockIpcCalls().find(
      (c) =>
        c.cmd === "study_progress" &&
        (c.args as { action?: string; id?: string }).action === "quiz" &&
        (c.args as { id?: string }).id === "q-2",
    );
    expect(quizCall?.args).toMatchObject({ heading: "" });
  });

  it("handles keyboard select, submit, advance, and guards", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.keyboard("2");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByText("Explanation one")).toBeInTheDocument();
    });
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByText("Quiz prompt two")).toBeInTheDocument();
    });
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Quiz prompt one")).toBeInTheDocument();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await user.keyboard("1");
    expect(screen.getByText("Quiz prompt one")).toBeInTheDocument();
    input.remove();
  });

  it("does not select on Ctrl+1", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.keyboard("{Control>}1{/Control}");
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes");
    });
  });

  it("shows unverified badge from citations fixture", async () => {
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        if (readStudyFile(payload) === "citations.json") {
          return {
            schema_version: 1,
            course: "cell-biology",
            failures: [
              {
                path: "study/quiz.json",
                id: "q-1",
                reason: "Span not found in digest",
              },
            ],
          };
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.hover(screen.getByText("Unverified"));
    expect(await screen.findByText("Span not found in digest")).toBeInTheDocument();
  });

  it("shows stale badge when artifact is stale", async () => {
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
      study_artifact_stale: () => true,
    });
    await waitForQuizReady();
    expect(screen.getByText(/Digests updated since last generation/i)).toBeInTheDocument();
  });

  it("shows unsaved badge and retries flush on click", async () => {
    let quizCalls = 0;
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
      study_progress: (args) => {
        if (studyProgressAction(args) === "quiz") {
          quizCalls += 1;
          throw new Error("worker server exited");
        }
        return {};
      },
    });
    const user = userEvent.setup();
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Beta/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /1 unsaved · Retry/i })).toBeInTheDocument();
      },
      { timeout: 12000 },
    );
    const callsBeforeRetry = quizCalls;
    await user.click(screen.getByRole("button", { name: /1 unsaved · Retry/i }));
    await waitFor(() => expect(quizCalls).toBeGreaterThan(callsBeforeRetry), {
      timeout: 10000,
    });
  });

  it("navigates source chip to digest with heading", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.click(
      screen.getByRole("button", {
        name: /Cell membranes · Membrane structure/i,
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
      expect(router.state.location.searchStr).toContain("heading=Membrane+structure");
    });
  });

  it("empty state generate and refresh gates", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitFor(
      () => {
        expect(
          screen.getByText(
            /No quiz yet for Cell Biology\. Generate questions from your digests\./,
          ),
        ).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect(call?.args).toMatchObject({
      course: "cell-biology",
      skill: "quiz",
      force: false,
    });
  });

  it("generate when signed out logs auth message without starting job", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      read_quiz_progress: () => ({}),
      check_auth: () => ({
        authenticated: false,
        reason: "Sign in required",
        docs_url: "https://example.com/docs",
      }),
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /^Generate$/i })).toBeInTheDocument();
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
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Refresh from digests/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((call?.args as { force?: boolean }).force).toBe(true);
  });

  it("disables generate for viewer libraries", async () => {
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      read_quiz_progress: () => ({}),
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

  it("shows empty state when pack course mismatches route", async () => {
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return { ...smallQuiz, course: "other-course" };
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          /No quiz yet for Cell Biology\. Generate questions from your digests\./,
        ),
      ).toBeInTheDocument();
    });
  });

  it("keeps question index when pack data refetches", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Quiz prompt two")).toBeInTheDocument();
    const refreshed = {
      ...smallQuiz,
      questions: smallQuiz.questions.map((q) =>
        q.id === "q-2" ? { ...q, prompt: "Quiz prompt two refreshed" } : q,
      ),
    };
    queryClient.setQueryData(qk.studyJson(FIXTURE_ROOT_FALL, "cell-biology", "quiz.json"), refreshed);
    await waitFor(() => {
      expect(screen.getByText("Quiz prompt two refreshed")).toBeInTheDocument();
    });
    expect(screen.getByText(/Question 2 of 2/i)).toBeInTheDocument();
  });

  it("shows Select a model when generating without a model", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      get_settings: () => ({ ...fixtureSettings, model_id: null }),
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /^Generate$/i })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /^Generate$/i }));
    expect(screen.getByText("Select a model in Settings.")).toBeInTheDocument();
  });

  it("disables generate while a study job is running", async () => {
    useJobStore.setState({ status: "running" });
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /^Generate$/i })).toBeDisabled();
      },
      { timeout: 8000 },
    );
  });

  it("never flashes empty state while quiz data is loading", async () => {
    const finishTracking = trackEmptyStateText(/No quiz yet for/i);
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    expect(finishTracking()).toEqual([]);
  });

  it("renders the pack when quiz progress read fails", async () => {
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => {
        throw new Error("progress unavailable");
      },
    });
    await waitForQuizReady();
    expect(screen.getByText("0 / 2 correct")).toBeInTheDocument();
  });

  it("applies success and destructive surfaces with icons after submit", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Alpha/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await waitFor(() => {
      expect(screen.getByText("Explanation one")).toBeInTheDocument();
    });
    const alpha = screen.getByRole("button", { name: /^Alpha/i });
    const beta = screen.getByRole("button", { name: /^Beta/i });
    expect(alpha.className).toMatch(/bg-destructive-surface/);
    expect(alpha.className).toMatch(/disabled:opacity-100/);
    expect(beta.className).toMatch(/bg-success-surface/);
    expect(beta.querySelector("svg")).toBeTruthy();
    expect(alpha.querySelector("svg")).toBeTruthy();
  });

  it("keeps selection and submitted state when the pack refetches", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
      study_progress: (args) => {
        if (studyProgressAction(args) === "quiz") {
          return new Promise(() => {});
        }
        return {};
      },
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Beta/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await waitFor(() => {
      expect(screen.getByText("Explanation one")).toBeInTheDocument();
    });
    const refreshed = {
      ...smallQuiz,
      questions: smallQuiz.questions.map((q) =>
        q.id === "q-1" ? { ...q, prompt: "Quiz prompt one refreshed" } : q,
      ),
    };
    queryClient.setQueryData(
      qk.studyJson(FIXTURE_ROOT_FALL, "cell-biology", "quiz.json"),
      refreshed,
    );
    await waitFor(() => {
      expect(screen.getByText("Quiz prompt one refreshed")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^Submit$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Beta/i }).className).toMatch(
      /border-primary|bg-success-surface/,
    );
  });

  it("selects choices with keys 1, 3, and 4", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.keyboard("1");
    expect(screen.getByRole("button", { name: /^Alpha/i }).className).toMatch(/ring-primary/);
    await user.keyboard("3");
    expect(screen.getByRole("button", { name: /^Gamma/i }).className).toMatch(/ring-primary/);
    await user.keyboard("4");
    expect(screen.getByRole("button", { name: /^Delta/i }).className).toMatch(/ring-primary/);
  });

  it("advances with ArrowRight", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Quiz prompt two")).toBeInTheDocument();
  });

  it("advances on Enter when no choice is selected", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Quiz prompt two")).toBeInTheDocument();
  });

  it("ignores quiz choice keys while a dialog is open", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-slot", "dialog-overlay");
    overlay.setAttribute("data-open", "");
    document.body.appendChild(overlay);
    await user.keyboard("2");
    expect(screen.getByRole("button", { name: /^Beta/i }).className).not.toMatch(/ring-primary/);
    overlay.remove();
  });

  it("shows wrong styling when an incorrect choice is submitted", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
      study_progress: (args) => {
        if (studyProgressAction(args) === "quiz") {
          return new Promise(() => {});
        }
        return {};
      },
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Alpha/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await waitFor(() => {
      expect(screen.getByText("Explanation one")).toBeInTheDocument();
    });
    expect(screen.getByText("0 / 2 correct")).toBeInTheDocument();
    const quizCall = getMockIpcCalls().find(
      (c) =>
        c.cmd === "study_progress" && (c.args as { action?: string }).action === "quiz",
    );
    expect(quizCall?.args).toMatchObject({ result: "wrong" });
  });

  it("resumes a submitted question after a Notes round trip", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Beta/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await waitFor(() => {
      expect(screen.getByText("Explanation one")).toBeInTheDocument();
    });
    expect(screen.getByText("1 / 2 correct")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Notes/i }));
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("link", { name: /Quiz/i }));
    await waitForQuizReady();
    expect(screen.getByText("Explanation one")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 correct")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Beta/i }).className).toMatch(/success/);
  });

  it("starts fresh when quiz pack identity changes", async () => {
    const user = userEvent.setup();
    let packPayload = smallQuiz;
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return packPayload;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Beta/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Quiz prompt two")).toBeInTheDocument();
    cleanup();
    packPayload = {
      ...smallQuiz,
      questions: [
        ...smallQuiz.questions,
        {
          id: "q-3",
          type: "multiple_choice" as const,
          prompt: "Quiz prompt three",
          choices: ["A", "B", "C", "D"],
          answer_index: 0,
          explanation: "Explanation three",
          source: { digest: "2026-09-12-membranes", heading: null },
        },
      ],
    };
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return packPayload;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitFor(() => {
      expect(screen.getByText("Quiz prompt one")).toBeInTheDocument();
      expect(screen.getByText("0 / 3 correct")).toBeInTheDocument();
    });
  });

  it("ignores corrupt persisted quiz sessions", async () => {
    const key = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "quiz");
    useStudySessionStore.setState({
      sessions: { [key]: { identity: "x", savedAt: 1 } as never },
    });
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    expect(screen.getByText("Quiz prompt one")).toBeInTheDocument();
  });

  it("restart clears in-session answers and returns to question 1", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return smallQuiz;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitForQuizReady();
    await user.click(screen.getByRole("button", { name: /^Beta/i }));
    await user.click(screen.getByRole("button", { name: /^Submit$/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Quiz prompt two")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Restart$/i }));
    await user.click(screen.getByRole("button", { name: /^Restart quiz$/i }));
    await waitFor(() => {
      expect(screen.getByText("Quiz prompt one")).toBeInTheDocument();
    });
    expect(screen.getByText("0 / 2 correct")).toBeInTheDocument();
    const key = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "quiz");
    const saved = useStudySessionStore.getState().sessions[key];
    expect(saved && "index" in saved ? saved.index : -1).toBe(0);
  });

  it("tab-switch round trip lands on question 3 after advancing twice", async () => {
    const user = userEvent.setup();
    const quizThree = {
      ...smallQuiz,
      questions: [
        ...smallQuiz.questions,
        {
          id: "q-3",
          type: "multiple_choice" as const,
          prompt: "Quiz prompt three",
          choices: ["A", "B", "C", "D"],
          answer_index: 0,
          explanation: "Explanation three",
          source: { digest: "2026-09-12-membranes", heading: null },
        },
      ],
    };
    await renderAppAtRoute("/course/cell-biology/quiz", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "quiz.json") {
          return quizThree;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
      read_quiz_progress: () => ({}),
    });
    await waitFor(() => {
      expect(screen.getByText("Quiz prompt one")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Quiz prompt three")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Notes/i }));
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("link", { name: /Quiz/i }));
    await waitFor(() => {
      expect(screen.getByText("Quiz prompt three")).toBeInTheDocument();
    });
    expect(screen.getByText(/Question 3 of 3/i)).toBeInTheDocument();
  });
});
