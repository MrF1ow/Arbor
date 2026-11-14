import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import * as flashcardsDomain from "~/domain/flashcards";
import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { fixtureCourseOverview, fixtureDigests, fixtureSettings } from "~/test/fixtures/data";
import { qk } from "~/lib/queries/keys";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED } from "~/test/fixtures/data";
import type { TodayCourseRow, TodayPayload } from "~/domain/today";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { studySessionKey } from "~/domain/study-session";
import { useJobStore } from "~/stores/job-store";
import { classScopeKey, useLectureSelectionStore } from "~/stores/lecture-selection-store";
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

async function waitForFlashcardsReady(dueTabCount = 14) {
  await waitFor(
    () => {
      expect(screen.getByTestId("flashcards-view")).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`Due today · ${dueTabCount}`, "i")),
      ).toBeInTheDocument();
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

describe("flashcards PR8", { timeout: 20000 }, () => {
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

  it("never flashes empty state while deck data is loading", async () => {
    const finishTracking = trackEmptyStateText(/No flashcards yet for/i);
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    expect(finishTracking()).toEqual([]);
  });

  it("optimistically advances after mastered grade while study_progress is pending", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    expect(screen.getByText(/Due today · 13/i)).toBeInTheDocument();
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
    const cached = queryClient.getQueryData<typeof fixtureCourseOverview>(
      qk.courseOverview(FIXTURE_ROOT_FALL, "cell-biology"),
    );
    expect(cached?.due.due_ids).toEqual(
      Array.from({ length: 13 }, (_, i) => `fc-${i + 2}`),
    );
    expect(cached?.due.count).toBe(13);
  });

  it("due again requeues with unchanged due count", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
            due: { due_ids: ["fc-1", "fc-2"], count: 2, deck_count: 3 },
          };
        }
        return {};
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/Due today · 2/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.click(screen.getByRole("button", { name: /^Again/i }));
    await waitFor(() => {
      expect(screen.getByText("Question two")).toBeInTheDocument();
    });
    expect(screen.getByText(/Due today · 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Next/i }));
    await waitFor(() => {
      expect(screen.getByText("Question one")).toBeInTheDocument();
    });
  });

  it("due mastered drops due count", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("toggles deck mode and rebuilds the session", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards?card=fc-99", {
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
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
        name: /Cell membranes · Membrane structure · p\. 12/i,
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/read/2026-09-12-membranes");
      expect(router.state.location.searchStr).toContain("heading=Membrane+structure");
    });
  });

  it("shows unverified badge from citations fixture", async () => {
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    const user = userEvent.setup();
    await user.hover(screen.getByText("Unverified"));
    expect(await screen.findByText("No matching digest span")).toBeInTheDocument();
  });

  it("shows stale badge when artifact is stale", async () => {
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    const refreshed = {
      ...smallDeck,
      cards: smallDeck.cards.map((c) =>
        c.id === "fc-2" ? { ...c, back: "Answer two refreshed" } : c,
      ),
    };
    queryClient.setQueryData(qk.studyJson(FIXTURE_ROOT_FALL, "cell-biology", "flashcards.json"), refreshed);
    await waitFor(() => {
      expect(screen.getByText("Question two")).toBeInTheDocument();
      expect(screen.getByText("Answer two refreshed")).toBeInTheDocument();
    });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("sends empty heading when source heading is null", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
            due: { due_ids: ["fc-1", "fc-2"], count: 2, deck_count: 3 },
          };
        }
        if (studyProgressAction(args) === "grade") {
          return new Promise(() => {});
        }
        return {};
      },
    });
    await waitForFlashcardsReady(2);
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.keyboard("3");
    const gradeCall = getMockIpcCalls().find(
      (c) =>
        c.cmd === "study_progress" &&
        (c.args as { action?: string; id?: string }).action === "grade" &&
        (c.args as { id?: string }).id === "fc-2",
    );
    expect(gradeCall?.args).toMatchObject({ heading: "" });
  });

  it("ignores flashcard keys while a dialog is open", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.keyboard(" ");
    expect(screen.getByText("Answer one")).toBeInTheDocument();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-slot", "dialog-overlay");
    overlay.setAttribute("data-open", "");
    document.body.appendChild(overlay);
    await user.keyboard("1");
    expect(screen.getByText("Answer one")).toBeInTheDocument();
    overlay.remove();
  });

  it("does not grade on Ctrl+1 and navigates to Notes", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.keyboard(" ");
    const gradesBefore = getMockIpcCalls().filter(
      (c) => c.cmd === "study_progress" && (c.args as { action?: string }).action === "grade",
    ).length;
    await user.keyboard("{Control>}1{/Control}");
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/overview");
    });
    const gradesAfter = getMockIpcCalls().filter(
      (c) => c.cmd === "study_progress" && (c.args as { action?: string }).action === "grade",
    ).length;
    expect(gradesAfter).toBe(gradesBefore);
  });

  it("removes flashcard key listener after leaving the view", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await router.navigate({ to: "/course/$course/overview", params: { course: "cell-biology" } });
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    const gradesBefore = getMockIpcCalls().filter(
      (c) => c.cmd === "study_progress" && (c.args as { action?: string }).action === "grade",
    ).length;
    await user.keyboard("3");
    const gradesAfter = getMockIpcCalls().filter(
      (c) => c.cmd === "study_progress" && (c.args as { action?: string }).action === "grade",
    ).length;
    expect(gradesAfter).toBe(gradesBefore);
  });

  it("card focus stays in due mode when the card is already due", async () => {
    await renderAppAtRoute("/course/cell-biology/practice/cards?card=fc-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitFor(() => {
      expect(screen.getByText("Question one")).toBeInTheDocument();
    });
    expect(screen.getByText(/Due today · 14/i)).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("unknown card param stays in due mode and clears search", async () => {
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards?card=missing-id", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.searchStr).not.toContain("card=");
    });
  });

  it("refetches cached deck after flush before focusing card param", async () => {
    const deckWithNew = {
      ...smallDeck,
      cards: [
        ...smallDeck.cards,
        {
          id: "fc-appended-1",
          front: "Appended question",
          back: "Appended answer",
          tags: [],
          source: { digest: "2026-09-12-membranes", heading: null, page: null },
        },
      ],
    };
    await renderAppAtRoute("/course/cell-biology/practice/cards?card=fc-appended-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return deckWithNew;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(screen.getByText("Appended question")).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(
      getMockIpcCalls().some(
        (call) =>
          call.cmd === "read_study_json" &&
          (call.args as { file?: string }).file === "flashcards.json",
      ),
    ).toBe(true);
  });

  it("shows Select a model when generating without a model", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      get_settings: () => ({ ...fixtureSettings, model_id: null }),
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
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
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /^Generate$/i })).toBeDisabled();
      },
      { timeout: 8000 },
    );
  });

  it("shows empty state when deck course mismatches route", async () => {
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return { ...smallDeck, course: "other-course" };
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          /No flashcards yet for Cell Biology\. Generate a deck from your digests\./,
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows No cards in deck in full mode", async () => {
    const user = userEvent.setup();
    const createReviewSpy = vi
      .spyOn(flashcardsDomain, "createReview")
      .mockReturnValue({ cards: [], index: 0, flipped: false });
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(screen.getByText(/Full deck · 86/i));
    expect(screen.getByText("No cards in deck.")).toBeInTheDocument();
    createReviewSpy.mockRestore();
  });

  it("Study full deck switches to the full deck session", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
            due: { due_ids: [], count: 0, deck_count: 3 },
          };
        }
        return {};
      },
    });
    await waitFor(() => {
      expect(screen.getByText("No cards due today.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Study full deck/i }));
    expect(screen.getByText("Question one")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("resumes full-deck position and flip state after a Notes round trip", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(screen.getByText(/Full deck · 86/i));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.getByText("Answer ninety-nine")).toBeInTheDocument();
    await router.navigate({ to: "/course/$course/overview", params: { course: "cell-biology" } });
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await router.navigate({ to: "/course/$course/practice/cards", params: { course: "cell-biology" } });
    await waitForFlashcardsReady();
    expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByText("Answer ninety-nine")).toBeInTheDocument();
  });

  it("card focus deep link overrides a saved session position", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(screen.getByText(/Full deck · 86/i));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await router.navigate({ to: "/course/$course/overview", params: { course: "cell-biology" } });
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await router.navigate({ to: "/course/$course/practice/cards", params: { course: "cell-biology" } });
    await waitFor(() => {
      expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    });
    cleanup();
    await renderAppAtRoute("/course/cell-biology/practice/cards?card=fc-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitFor(() => {
      expect(screen.getByText("Question one")).toBeInTheDocument();
    });
    expect(screen.getByText(/Due today · 14/i)).toBeInTheDocument();
  });

  it("starts fresh when deck identity changes and overwrites the saved entry", async () => {
    const user = userEvent.setup();
    const deckV2 = {
      ...smallDeck,
      cards: [
        ...smallDeck.cards,
        {
          id: "fc-new",
          front: "Question new",
          back: "Answer new",
          tags: [],
          source: { digest: "2026-09-12-membranes", heading: null, page: null },
        },
      ],
    };
    let deckPayload: typeof smallDeck = smallDeck;
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return deckPayload;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(screen.getByText(/Full deck · 86/i));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    cleanup();
    deckPayload = deckV2;
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return deckPayload;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    expect(screen.getByText("Question one")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    const key = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "flashcards");
    await waitFor(() => {
      const saved = useStudySessionStore.getState().sessions[key];
      expect(saved && "identity" in saved ? saved.identity : "").toContain("fc-new");
    });
  });

  it("ignores corrupt persisted flashcard sessions", async () => {
    const key = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "flashcards");
    useStudySessionStore.setState({
      sessions: {
        [key]: { identity: "bad", savedAt: 1 } as never,
      },
    });
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    expect(screen.getByText("Question one")).toBeInTheDocument();
  });

  it.each([
    ["due only", { deckMode: "due" }],
    ["due with null cardIds", { deckMode: "due", cardIds: null }],
    ["non-object", "not-an-object"],
  ] as const)("ignores corrupt due-shaped persisted session (%s)", async (_label, corrupt) => {
    const key = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "flashcards");
    useStudySessionStore.setState({
      sessions: { [key]: corrupt as never },
    });
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    expect(screen.getByText("Question one")).toBeInTheDocument();
  });

  it("keeps due again requeue order live and after a Notes round trip", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
            due: { due_ids: ["fc-1", "fc-2", "fc-99"], count: 3, deck_count: 3 },
          };
        }
        return {};
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/Due today · 3/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.click(screen.getByRole("button", { name: /^Again/i }));
    await waitFor(() => {
      expect(screen.getByText("Question two")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Next/i }));
    expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    await router.navigate({ to: "/course/$course/overview", params: { course: "cell-biology" } });
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await router.navigate({ to: "/course/$course/practice/cards", params: { course: "cell-biology" } });
    await waitFor(() => {
      expect(screen.getByText(/Due today · 3/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("restores due mode on the saved card after earlier ids leave the due list", async () => {
    const deckIdentity = `${FIXTURE_ROOT_FALL}|cell-biology:fc-1\u0000fc-2\u0000fc-99`;
    const key = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "flashcards");
    useStudySessionStore.setState({
      sessions: {
        [key]: {
          identity: deckIdentity,
          savedAt: 1,
          deckMode: "due",
          cardIds: ["fc-1", "fc-2", "fc-99"],
          index: 1,
          flipped: true,
        },
      },
    });
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
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
            due: { due_ids: ["fc-2", "fc-99"], count: 2, deck_count: 3 },
          };
        }
        return {};
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/Due today · 2/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Question two")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("Answer two")).toBeInTheDocument();
  });

  it("restart clears saved position and returns to the first card", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await user.click(screen.getByText(/Full deck · 86/i));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    expect(screen.getByText("Question two")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Restart$/i }));
    await user.click(screen.getByRole("button", { name: /^Restart deck$/i }));
    await waitFor(() => {
      expect(screen.getByText("Question one")).toBeInTheDocument();
    });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    const key = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "flashcards");
    const saved = useStudySessionStore.getState().sessions[key];
    expect(saved && "index" in saved ? saved.index : -1).toBe(0);
  });

  it("keeps flashcard sessions independent per course key", async () => {
    const bioIdentity = `${FIXTURE_ROOT_FALL}|cell-biology:fc-1\u0000fc-2\u0000fc-99`;
    const keyBio = studySessionKey(FIXTURE_ROOT_FALL, "cell-biology", "flashcards");
    const keyChem = studySessionKey(FIXTURE_ROOT_FALL, "organic-chemistry", "flashcards");
    useStudySessionStore.setState({
      sessions: {
        [keyBio]: {
          identity: bioIdentity,
          savedAt: 1,
          deckMode: "full",
          cardIds: ["fc-1", "fc-2", "fc-99"],
          index: 2,
          flipped: false,
        },
        [keyChem]: {
          identity: `${FIXTURE_ROOT_FALL}|organic-chemistry:fc-1`,
          savedAt: 2,
          deckMode: "full",
          cardIds: ["fc-1"],
          index: 0,
          flipped: false,
        },
      },
    });
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "flashcards.json") {
          return smallDeck;
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitForFlashcardsReady();
    await userEvent.setup().click(screen.getByText(/Full deck · 86/i));
    await waitFor(() => {
      expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    });
  });
});

const MEMBRANES = "cell-biology/digests/2026-09-12-membranes.md";
const MITO = "cell-biology/digests/2026-09-15-mitochondria.md";
const STEM = "cell-biology/digests/2026-10-12-stem-cells.md";
const SCOPE_KEY = classScopeKey(FIXTURE_ROOT_FALL, "cell-biology");

function card(id: string, digest: string) {
  return {
    id,
    front: `Question ${id}`,
    back: `Answer ${id}`,
    tags: [],
    source: { digest, heading: null, page: null },
  };
}

/** Two lectures' cards, interleaved, all due. */
const twoLectureDeck = {
  schema_version: 1 as const,
  course: "cell-biology",
  cards: [
    card("fc-1", "digests/2026-09-12-membranes.md"),
    card("fc-2", "digests/2026-09-15-mitochondria.md"),
    card("fc-3", "digests/2026-09-12-membranes.md"),
    card("fc-4", "digests/2026-09-15-mitochondria.md"),
  ],
};

const twoLectureFixtures = {
  read_study_json: (payload: unknown) => {
    if (readStudyFile(payload) === "flashcards.json") {
      return twoLectureDeck;
    }
    return { schema_version: 1, course: "cell-biology", failures: [] };
  },
  study_progress: (args: unknown) =>
    studyProgressAction(args) === "overview"
      ? { ...fixtureCourseOverview, due: { due_ids: ["fc-1", "fc-2", "fc-3", "fc-4"], count: 4, deck_count: 4 } }
      : {},
};

describe("flashcards scoped to the ticked lectures", { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    localStorage.clear();
    useStudySessionStore.persist.clearStorage();
    useStudySessionStore.setState({ sessions: {} });
    useLectureSelectionStore.setState({ byClass: {} });
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

  it("reviews only the cards of the ticked lectures and grades them", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MITO]);
    await renderAppAtRoute("/course/cell-biology/practice/cards", twoLectureFixtures);
    await waitForFlashcardsReady(2);
    expect(screen.getByText(/Full deck · 2/i)).toBeInTheDocument();
    expect(screen.getByText("Question fc-2")).toBeInTheDocument();
    expect(screen.queryByText("Question fc-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.keyboard("3");
    await waitFor(() => expect(screen.getByText("Question fc-4")).toBeInTheDocument());
    const grade = getMockIpcCalls().find(
      (c) => c.cmd === "study_progress" && (c.args as { action?: string }).action === "grade",
    );
    expect(grade?.args).toMatchObject({
      id: "fc-2",
      result: "mastered",
      digest: "digests/2026-09-15-mitochondria.md",
    });
  });

  it('names a whole ticked unit in the chip: "Studying Membranes · 2 lectures"', async () => {
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MEMBRANES, MITO]);
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      ...twoLectureFixtures,
      list_digests: () => [
        { title: "Cell membranes", date: "2026-09-12", path: MEMBRANES, unit: "Membranes", source_path: null },
        { title: "Mitochondria", date: "2026-09-15", path: MITO, unit: "Membranes", source_path: null },
      ],
    });
    await waitForFlashcardsReady(4);
    expect(screen.getByText("Studying")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop studying Membranes · 2 lectures" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cards" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Quiz" })).toBeInTheDocument();
  });

  it("ignores a ticked lecture that no longer exists: whole deck, no chip, Generate sends no lectures", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, ["cell-biology/digests/2026-01-01-deleted.md"]);
    await renderAppAtRoute("/course/cell-biology/practice/cards", twoLectureFixtures);
    await waitForFlashcardsReady(4);
    expect(screen.getByText("Question fc-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Stop studying/ })).not.toBeInTheDocument();
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Refresh from digests/ }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect(JSON.stringify(call?.args)).not.toContain("deleted");
  });

  it("shows the Studying chip, and clearing it brings the whole deck back", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MITO]);
    await renderAppAtRoute("/course/cell-biology/practice/cards", twoLectureFixtures);
    await waitForFlashcardsReady(2);
    await user.click(screen.getByRole("button", { name: "Stop studying 1 lecture" }));
    await waitForFlashcardsReady(4);
    expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toBeUndefined();
    expect(screen.getByText("Question fc-1")).toBeInTheDocument();
  });

  it("shows No flashcards yet for a scope with no cards, and Generate sends the lectures", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [STEM, MEMBRANES]);
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [STEM]);
    await renderAppAtRoute("/course/cell-biology/practice/cards", twoLectureFixtures);
    await waitFor(
      () => expect(screen.getByText(/No flashcards yet for this lecture\. Generate a deck from its digest\./)).toBeInTheDocument(),
      { timeout: 8000 },
    );
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect(call?.args).toMatchObject({
      course: "cell-biology",
      skill: "flashcards",
      force: false,
      digests: [STEM],
    });
  });

  it("refreshes the whole class from its digests even when lectures are ticked", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MITO]);
    await renderAppAtRoute("/course/cell-biology/practice/cards", twoLectureFixtures);
    await waitForFlashcardsReady(2);
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Refresh from digests/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect(call?.args).toMatchObject({ force: true });
    expect(call?.args).not.toHaveProperty("digests");
  });

  it("a scoped grade that cannot be sent leaves the class-wide due list intact", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MITO]);
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
      ...twoLectureFixtures,
      study_progress: (args: unknown) => {
        if (studyProgressAction(args) === "overview") {
          return { ...fixtureCourseOverview, due: { due_ids: ["fc-1", "fc-2", "fc-3", "fc-4"], count: 4, deck_count: 4 } };
        }
        if (studyProgressAction(args) === "grade") {
          throw new Error("worker offline");
        }
        return {};
      },
    });
    await waitForFlashcardsReady(2);
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.keyboard("3");
    await waitFor(() => expect(screen.getByText(/Due today · 1/i)).toBeInTheDocument());
    const cached = queryClient.getQueryData<{ due: { due_ids: string[] } }>(
      qk.courseOverview(FIXTURE_ROOT_FALL, "cell-biology"),
    );
    expect(cached?.due.due_ids).toEqual(["fc-1", "fc-3", "fc-4"]);
    await user.click(screen.getByRole("button", { name: "Stop studying 1 lecture" }));
    await waitFor(() => expect(screen.getByText(/Full deck · 4/i)).toBeInTheDocument(), { timeout: 8000 });
    expect(screen.getByText(/Due today · 3/i)).toBeInTheDocument();
  });

  it("keeps the whole-class session while lectures are ticked and cleared", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", twoLectureFixtures);
    await waitForFlashcardsReady(4);
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await waitFor(() => expect(screen.getByText("Question fc-2")).toBeInTheDocument());
    act(() => useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MITO]));
    await waitFor(() => expect(screen.getByText(/Full deck · 2/i)).toBeInTheDocument());
    expect(screen.getByText("Question fc-2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await waitFor(() => expect(screen.getByText("Question fc-4")).toBeInTheDocument());
    act(() => useLectureSelectionStore.getState().clear(SCOPE_KEY));
    await waitFor(() => expect(screen.getByText(/Full deck · 4/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Question fc-2")).toBeInTheDocument());
  });

  it("an unscoped Generate sends no digests", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      read_study_json: (payload: unknown) => {
        if (readStudyFile(payload) === "flashcards.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: "cell-biology", failures: [] };
      },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Generate$/i })).toBeInTheDocument(), { timeout: 8000 });
    await user.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    const call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect(call?.args).not.toHaveProperty("digests");
  });

  it("opens a search hit outside the scope by dropping the scope", async () => {
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MITO]);
    await renderAppAtRoute("/course/cell-biology/practice/cards?card=fc-1", twoLectureFixtures);
    await waitFor(() => expect(screen.getByText("Question fc-1")).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toBeUndefined());
    expect(screen.getByText("Question fc-1")).toBeInTheDocument();
  });
});

function todayRow(course: string, dueCount: number, o: Partial<TodayCourseRow> = {}): TodayCourseRow {
  return {
    course,
    digest_count: 6,
    due_ids: Array.from({ length: dueCount }, (_, i) => `${course}-${i}`),
    deck_count: 20,
    mastered: 10,
    mastery: 0.5,
    exam_date: null,
    days_to_exam: null,
    plan: null,
    ...o,
  };
}

function todayPayload(courses: TodayCourseRow[]): TodayPayload {
  return {
    courses,
    weak_topics: [],
    quiz_accuracy: { this_week: { correct: 0, total: 0 }, last_week: { correct: 0, total: 0 } },
    next_exam: null,
  };
}

const oneCardDeck = {
  schema_version: 1 as const,
  course: "cell-biology",
  cards: [card("fc-1", "digests/2026-09-12-membranes.md")],
};

/** A one-card deck whose single card is due; `today` answers `study_today` per library. */
function lastCardFixtures(today: (root: string) => TodayPayload) {
  return {
    read_study_json: (payload: unknown) =>
      readStudyFile(payload) === "flashcards.json"
        ? oneCardDeck
        : { schema_version: 1, course: "cell-biology", failures: [] },
    study_progress: (args: unknown) =>
      studyProgressAction(args) === "overview"
        ? { ...fixtureCourseOverview, due: { due_ids: ["fc-1"], count: 1, deck_count: 1 } }
        : {},
    study_today: (args: unknown) => today(String((args as { root?: string }).root ?? "")),
  };
}

async function gradeLastCard(user: ReturnType<typeof userEvent.setup>) {
  await waitForFlashcardsReady(1);
  await user.click(screen.getByRole("button", { name: /^Flip$/i }));
  await user.keyboard("3");
}

describe("Next: <class> after the due cards are done", { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    localStorage.clear();
    useStudySessionStore.persist.clearStorage();
    useStudySessionStore.setState({ sessions: {} });
    useLectureSelectionStore.setState({ byClass: {} });
    clearMockIpcLog();
  });

  afterEach(() => {
    cleanup();
    resetMockHandlerTimers();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("offers the next class with due cards and opens it", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute(
      "/course/cell-biology/practice/cards",
      lastCardFixtures((root) =>
        root === FIXTURE_ROOT_SHARED
          ? todayPayload([todayRow("collab-notes", 8)])
          : todayPayload([
              todayRow("cell-biology", 0),
              todayRow("organic-chemistry-ii", 5, { exam_date: "2026-11-16", days_to_exam: 9 }),
            ]),
      ),
    );
    await gradeLastCard(user);
    const next = await screen.findByRole("button", { name: "Next: Organic Chemistry II · 5 due" }, { timeout: 8000 });
    await user.click(next);
    await waitFor(() => expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/practice/cards"));
  });

  it("opens a class in another library through the library switch", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute(
      "/course/cell-biology/practice/cards",
      lastCardFixtures((root) =>
        root === FIXTURE_ROOT_SHARED
          ? todayPayload([todayRow("collab-notes", 8)])
          : todayPayload([todayRow("cell-biology", 0)]),
      ),
    );
    await gradeLastCard(user);
    await user.click(await screen.findByRole("button", { name: "Next: Collab Notes · 8 due" }, { timeout: 8000 }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/course/collab-notes/practice/cards"));
    expect(getMockIpcLog()).toContain("save_settings");
  });

  it("decides on fresh counts: a class reviewed since the last refresh is not offered", async () => {
    const user = userEvent.setup();
    let graded = false;
    await renderAppAtRoute("/course/cell-biology/practice/cards", {
      ...lastCardFixtures((root) =>
        root === FIXTURE_ROOT_SHARED
          ? todayPayload([todayRow("collab-notes", 8)])
          : todayPayload([
              todayRow("cell-biology", graded ? 0 : 1),
              // On screen it still looks due; by now the worker says it is done.
              todayRow("organic-chemistry-ii", graded ? 0 : 5, { exam_date: "2026-11-16", days_to_exam: 9 }),
            ]),
      ),
      study_progress: (args: unknown) => {
        if (studyProgressAction(args) === "grade") {
          graded = true;
          return {};
        }
        return studyProgressAction(args) === "overview"
          ? { ...fixtureCourseOverview, due: { due_ids: ["fc-1"], count: 1, deck_count: 1 } }
          : {};
      },
    });
    await gradeLastCard(user);
    expect(await screen.findByRole("button", { name: "Next: Collab Notes · 8 due" }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next: Organic Chemistry/ })).not.toBeInTheDocument();
  });

  it("never offers the class just finished, even when scoped cards are done and others remain due", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute(
      "/course/cell-biology/practice/cards",
      lastCardFixtures((root) =>
        root === FIXTURE_ROOT_SHARED
          ? todayPayload([])
          : todayPayload([
              todayRow("cell-biology", 3, { exam_date: "2026-11-16", days_to_exam: 9 }),
              todayRow("linear-algebra", 2),
            ]),
      ),
    );
    await gradeLastCard(user);
    expect(await screen.findByRole("button", { name: "Next: Linear Algebra · 2 due" }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next: Cell Biology/ })).not.toBeInTheDocument();
  });

  it("says no cards are due when no other class has any", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute(
      "/course/cell-biology/practice/cards",
      lastCardFixtures((root) =>
        root === FIXTURE_ROOT_SHARED ? todayPayload([]) : todayPayload([todayRow("cell-biology", 0), todayRow("linear-algebra", 0)]),
      ),
    );
    await gradeLastCard(user);
    await waitFor(() => expect(screen.getByText("No cards due today.")).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(getMockIpcLog()).toContain("study_today"));
    expect(screen.queryByRole("button", { name: /^Next: / })).not.toBeInTheDocument();
  });
});

const nsFile = (p: unknown) => String((p as Record<string, unknown>).file ?? "");
const nsAct = (p: unknown) => String((p as Record<string, unknown>).action ?? "");
const nsCourse = (p: unknown) => String((p as Record<string, unknown>).course ?? "");
const nsCard = (id: string, digest: string) => ({ id, front: `Question ${id}`, back: `Answer ${id}`, tags: [], source: { digest, heading: null, page: null } });
const NS_OC = "organic-chemistry-ii";
const OC_L1 = `${NS_OC}/digests/2026-09-12-alkenes.md`;
const OC_L2 = `${NS_OC}/digests/2026-09-19-alkynes.md`;
const ocDeck = { schema_version: 1 as const, course: NS_OC, cards: [nsCard("oc-1", "digests/2026-09-12-alkenes.md"), nsCard("oc-2", "digests/2026-09-19-alkynes.md"), nsCard("oc-3", "digests/2026-09-19-alkynes.md"), nsCard("oc-4", "digests/2026-09-19-alkynes.md"), nsCard("oc-5", "digests/2026-09-19-alkynes.md")] };
const cbDeck = { schema_version: 1 as const, course: "cell-biology", cards: [nsCard("fc-1", "digests/2026-09-12-membranes.md")] };
const nsRow = (c: string, n: number, o = {}) => ({ course: c, digest_count: 6, due_ids: Array.from({ length: n }, (_, i) => `${c}-${i}`), deck_count: 20, mastered: 10, mastery: 0.5, exam_date: null, days_to_exam: null, plan: null, ...o });

describe("Next: <class> opens the class on its due cards (C28)", { timeout: 30000 }, () => {
  beforeEach(() => { vi.useRealTimers(); resetAuthRefreshForTests(); resetStudyWriteQueueForTests(); localStorage.clear(); useStudySessionStore.persist.clearStorage(); useStudySessionStore.setState({ sessions: {} }); useLectureSelectionStore.setState({ byClass: {} }); clearMockIpcLog(); });
  afterEach(() => { cleanup(); resetMockHandlerTimers(); clearTauriMocks(); vi.restoreAllMocks(); });

  it("Next: Organic Chemistry II · 4 due ignores the lectures ticked there earlier", async () => {
    const user = userEvent.setup();
    // the user ticked one Alkenes lecture in Organic Chemistry II earlier this session (its cards are not due)
    useLectureSelectionStore.getState().setScope(classScopeKey(FIXTURE_ROOT_FALL, NS_OC), [OC_L1]);
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards", {
      list_digests: (p: unknown) => nsCourse(p) === NS_OC ? [{ title: "Alkenes", date: "2026-09-12", path: OC_L1, unit: null, source_path: null }, { title: "Alkynes", date: "2026-09-19", path: OC_L2, unit: null, source_path: null }] : fixtureDigests,
      read_study_json: (p: unknown) => nsFile(p) === "flashcards.json" ? (nsCourse(p) === NS_OC ? ocDeck : cbDeck) : { schema_version: 1, course: nsCourse(p), failures: [] },
      study_progress: (a: unknown) => nsAct(a) === "overview" ? (nsCourse(a) === NS_OC ? { ...fixtureCourseOverview, due: { due_ids: ["oc-2", "oc-3", "oc-4", "oc-5"], count: 4, deck_count: 5 } } : { ...fixtureCourseOverview, due: { due_ids: ["fc-1"], count: 1, deck_count: 1 } }) : {},
      study_today: () => ({ courses: [nsRow("cell-biology", 0), nsRow(NS_OC, 4)], weak_topics: [], quiz_accuracy: { this_week: { correct: 0, total: 0 }, last_week: { correct: 0, total: 0 } }, next_exam: null }),
    });
    await waitFor(() => expect(screen.getByText(/Due today · 1/i)).toBeInTheDocument(), { timeout: 8000 });
    await user.click(screen.getByRole("button", { name: /^Flip$/i }));
    await user.keyboard("3");
    const next = await screen.findByRole("button", { name: /Next: Organic Chemistry II · 4 due/ }, { timeout: 8000 });
    await user.click(next);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${NS_OC}/practice/cards`));
    await waitFor(() => expect(screen.getByTestId("flashcards-view")).toBeInTheDocument(), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.getByText(/Due today · 4/i)).toBeInTheDocument();
    expect(useLectureSelectionStore.getState().byClass[classScopeKey(FIXTURE_ROOT_FALL, NS_OC)]).toBeUndefined();
  });
});
