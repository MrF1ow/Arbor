import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import * as flashcardsDomain from "~/domain/flashcards";
import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { fixtureCourseOverview, fixtureSettings } from "~/test/fixtures/data";
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

  it("never flashes empty state while deck data is loading", async () => {
    const finishTracking = trackEmptyStateText(/No flashcards yet for/i);
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
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
        name: /Cell membranes · Membrane structure · p\. 12/i,
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
    const user = userEvent.setup();
    await user.hover(screen.getByText("Unverified"));
    expect(await screen.findByText("No matching digest span")).toBeInTheDocument();
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
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    const { router } = await renderAppAtRoute("/course/cell-biology/flashcards", {
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
      expect(router.state.location.pathname).toContain("/notes");
    });
    const gradesAfter = getMockIpcCalls().filter(
      (c) => c.cmd === "study_progress" && (c.args as { action?: string }).action === "grade",
    ).length;
    expect(gradesAfter).toBe(gradesBefore);
  });

  it("removes flashcard key listener after leaving the view", async () => {
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
    await user.click(screen.getByRole("link", { name: /Notes/i }));
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
    await renderAppAtRoute("/course/cell-biology/flashcards?card=fc-1", {
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
    const { router } = await renderAppAtRoute("/course/cell-biology/flashcards?card=missing-id", {
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
    await renderAppAtRoute("/course/cell-biology/flashcards?card=fc-appended-1", {
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
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
        expect(screen.getByRole("button", { name: /^Generate$/i })).toBeDisabled();
      },
      { timeout: 8000 },
    );
  });

  it("shows empty state when deck course mismatches route", async () => {
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    expect(screen.getByText("No cards in deck.")).toBeInTheDocument();
    createReviewSpy.mockRestore();
  });

  it("Study full deck switches to the full deck session", async () => {
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
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.getByText("Answer ninety-nine")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Notes/i }));
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("link", { name: /Flashcards/i }));
    await waitForFlashcardsReady();
    expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByText("Answer ninety-nine")).toBeInTheDocument();
  });

  it("card focus deep link overrides a saved session position", async () => {
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
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    await user.click(screen.getByRole("link", { name: /Notes/i }));
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("link", { name: /Flashcards/i }));
    await waitFor(() => {
      expect(screen.getByText("Question ninety-nine")).toBeInTheDocument();
    });
    cleanup();
    await renderAppAtRoute("/course/cell-biology/flashcards?card=fc-1", {
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
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
    await user.click(screen.getByRole("link", { name: /Notes/i }));
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("link", { name: /Flashcards/i }));
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
    await renderAppAtRoute("/course/cell-biology/flashcards", {
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
