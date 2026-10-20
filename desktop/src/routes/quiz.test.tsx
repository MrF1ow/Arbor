import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

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

describe("quiz PR9", { timeout: 20000 }, () => {
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
});
