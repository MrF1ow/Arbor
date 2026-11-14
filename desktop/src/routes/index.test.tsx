import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DigestInfo } from "~/domain/types";
import type { ReadingEntry } from "~/domain/lectures";
import type { TodayCourseRow, TodayPayload, WeakTopic } from "~/domain/today";
import { lecturesFromSearch } from "~/lib/class-path";
import { qk } from "~/lib/queries/keys";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderAppAtRoute } from "~/test/render";
import { useJobStore } from "~/stores/job-store";
import { classScopeKey, useLectureSelectionStore } from "~/stores/lecture-selection-store";
import { studySessionKey } from "~/domain/study-session";
import { useStudySessionStore } from "~/stores/study-session-store";
import { useUiStore } from "~/stores/ui-store";

type Fixtures = NonNullable<Parameters<typeof renderAppAtRoute>[1]>;

function row(course: string, o: Partial<TodayCourseRow> = {}): TodayCourseRow {
  return {
    course,
    digest_count: 6,
    due_ids: [],
    deck_count: 20,
    mastered: 10,
    mastery: 0.5,
    exam_date: null,
    days_to_exam: null,
    plan: null,
    ...o,
  };
}

const due = (course: string, n: number) => Array.from({ length: n }, (_, i) => `${course}-${i}`);

function payload(courses: TodayCourseRow[], o: Partial<TodayPayload> = {}): TodayPayload {
  return {
    courses,
    weak_topics: [],
    quiz_accuracy: { this_week: { correct: 0, total: 0 }, last_week: { correct: 0, total: 0 } },
    next_exam: null,
    ...o,
  };
}

function weak(course: string, o: Partial<WeakTopic> = {}): WeakTopic {
  return {
    course,
    label: "Active vs passive transport",
    digest: "digests/2026-10-08-membrane-transport.md",
    heading: "Active transport",
    wrong_rate: 5 / 9,
    wrong: 5,
    correct: 4,
    ...o,
  };
}

/** Fall 2026 answers `fall`, the shared library `shared`; a function answers per call. */
function todayBy(
  fall: TodayPayload | (() => TodayPayload | Promise<TodayPayload>),
  shared: TodayPayload | (() => TodayPayload | Promise<TodayPayload>),
): NonNullable<Fixtures["study_today"]> {
  return (args: unknown) => {
    const answer = (args as { root?: string }).root === FIXTURE_ROOT_SHARED ? shared : fall;
    return typeof answer === "function" ? answer() : answer;
  };
}

const EMPTY: TodayPayload = payload([]);

/** The scenario of the design's Today frame, spread over two libraries. */
const FALL_TODAY = payload(
  [
    row("cell-biology", {
      digest_count: 14,
      due_ids: due("cb", 18),
      mastery: 0.82,
      exam_date: "2026-12-01",
      days_to_exam: 17,
    }),
    row("organic-chemistry-ii", {
      digest_count: 11,
      due_ids: due("oc", 15),
      mastery: 0.64,
      exam_date: "2026-11-16",
      days_to_exam: 9,
      plan: { done: 5, total: 8 },
    }),
    row("linear-algebra", { digest_count: 9, due_ids: [], mastery: null, deck_count: 0, mastered: 0 }),
  ],
  {
    weak_topics: [weak("cell-biology")],
    quiz_accuracy: { this_week: { correct: 7, total: 9 }, last_week: { correct: 5, total: 7 } },
    next_exam: { course: "organic-chemistry-ii", exam_date: "2026-11-16", days_to_exam: 9 },
  },
);
const SHARED_TODAY = payload([row("collab-notes", { digest_count: 3, due_ids: due("cn", 8), mastery: 0.35 })], {
  weak_topics: [weak("collab-notes", { label: "Cross-price elasticity", wrong: 3, correct: 3, wrong_rate: 0.5 })],
  quiz_accuracy: { this_week: { correct: 3, total: 3 }, last_week: { correct: 1, total: 3 } },
});

function digest(course: string, stem: string, title: string): DigestInfo {
  return {
    title,
    date: stem.slice(0, 10),
    path: `${course}/digests/${stem}.md`,
    unit: null,
    source_path: `${course}/${stem}.pdf`,
  };
}

const DIGESTS: Record<string, DigestInfo[]> = {
  "cell-biology": [
    digest("cell-biology", "2026-10-08-membrane-transport", "Membrane transport"),
    digest("cell-biology", "2026-10-13-cell-signalling", "Cell signalling"),
    digest("cell-biology", "2026-09-02-cell-theory", "Cell theory"),
  ],
  "collab-notes": [digest("collab-notes", "2026-11-09-genome-sequencing", "Genome sequencing")],
};

const READING_BY_ROOT: Record<string, Record<string, ReadingEntry>> = {
  [FIXTURE_ROOT_FALL]: {
    "cell-biology/digests/2026-10-08-membrane-transport.md": {
      fraction: 0.4,
      last_opened: "2026-11-12T18:00:00Z",
      read: false,
    },
    "cell-biology/digests/2026-09-02-cell-theory.md": {
      fraction: 1,
      last_opened: "2026-09-02T18:00:00Z",
      read: true,
    },
  },
  [FIXTURE_ROOT_SHARED]: {},
};

const WITH_READING: Fixtures = {
  study_today: todayBy(FALL_TODAY, SHARED_TODAY),
  list_digests: (args: unknown) => DIGESTS[(args as { course?: string }).course ?? ""] ?? [],
  read_reading_state: (args: unknown) => READING_BY_ROOT[(args as { root?: string }).root ?? ""] ?? {},
};

const NO_LIBRARY: Fixtures["get_settings"] = () => ({
  ...fixtureSettings,
  knowledge_root: null,
  active_root: null,
  knowledge_roots: [],
});

async function renderToday(fixtures: Fixtures = WITH_READING) {
  const rendered = await renderAppAtRoute("/", fixtures);
  const page = await screen.findByTestId("today-page");
  // The summary has arrived once the sections that need it are on the page.
  await within(page).findByTestId("today-continue");
  return { ...rendered, page };
}

describe("Today (the / route)", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true, lastCourse: null });
    useJobStore.setState({ status: "idle", step: null, label: null, root: null, progress: null });
    clearMockIpcLog();
    useStudySessionStore.setState({ sessions: {} });
    resetStudyWriteQueueForTests();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("stays on / (no redirect to a class) and marks the Today row current", async () => {
    const { router, page } = await renderToday();
    expect(router.state.location.pathname).toBe("/");
    expect(within(page).getByRole("heading", { name: "Today" })).toBeInTheDocument();
    const sidebar = await screen.findByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: /Today/ })).toHaveAttribute("aria-current", "page");
  });

  it("Review sums the cards due in every library, with the classes and about 18 s per card", async () => {
    const { page } = await renderToday();
    const review = within(page).getByTestId("today-review");
    // 18 + 15 + 8 = 41 cards across 3 classes; 41 * 18 s = 12.3 min.
    await within(review).findByText("41 cards");
    expect(within(review).getByText("due across 3 classes · about 12 min")).toBeInTheDocument();
    expect(within(review).getByRole("button", { name: "Start review" })).toBeInTheDocument();
  });

  it("Next exam shows the days left, the class and date, and the study plan progress", async () => {
    const { page } = await renderToday();
    const exam = within(page).getByTestId("today-next-exam");
    await within(exam).findByText("9 days");
    expect(within(exam).getByText(/Organic Chemistry II · Nov 16/)).toBeInTheDocument();
    expect(within(exam).getByText("Study plan 63% done")).toBeInTheDocument();
  });

  it("Quiz accuracy sums both libraries and compares with last week", async () => {
    const { page } = await renderToday();
    const quiz = within(page).getByTestId("today-quiz-accuracy");
    // This week 10 of 12 = 83%; last week 6 of 10 = 60%.
    await within(quiz).findByText("83%");
    expect(within(quiz).getByText("last 7 days · up from 60%")).toBeInTheDocument();
  });

  it("Continue reading lists opened-but-unread lectures with their % and never-opened ones as New, and drops read ones", async () => {
    const { page } = await renderToday();
    const reading = within(page).getByTestId("today-continue");
    const rows = await within(reading).findAllByRole("button");
    const text = rows.map((r) => r.textContent);
    expect(text).toEqual([
      expect.stringMatching(/Membrane transport.*40% read/),
      expect.stringMatching(/Genome sequencing.*New/),
      expect.stringMatching(/Cell signalling.*New/),
    ]);
    expect(within(reading).queryByText("Cell theory")).not.toBeInTheDocument();
  });

  it("opens a lecture from Continue reading in its class", async () => {
    const user = userEvent.setup();
    const { page, router } = await renderToday();
    const reading = within(page).getByTestId("today-continue");
    await user.click(await within(reading).findByRole("button", { name: /Membrane transport/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/course/cell-biology/read/2026-10-08-membrane-transport",
      );
    });
  });

  it("Weak topics show wrong of attempts, and Drill opens that lecture's quiz with ?lectures=", async () => {
    const user = userEvent.setup();
    const { page, router } = await renderToday();
    const topics = within(page).getByTestId("today-weak");
    expect(await within(topics).findByText("Active vs passive transport")).toBeInTheDocument();
    expect(within(topics).getByText("5 of 9")).toBeInTheDocument();
    expect(within(topics).getByText("Cross-price elasticity")).toBeInTheDocument();
    expect(within(topics).getByText("3 of 6")).toBeInTheDocument();

    const drills = within(topics).getAllByRole("button", { name: /Drill/ });
    await user.click(drills[0]!);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/practice/quiz");
    });
    const search = router.state.location.search as { lectures?: string };
    expect(lecturesFromSearch(search.lectures)).toEqual([
      "cell-biology/digests/2026-10-08-membrane-transport.md",
    ]);
  });

  it("a weak topic from a worker that sends no counts shows its name and Drill, with no \"undefined of NaN\"", async () => {
    const bare: Partial<WeakTopic> = weak("cell-biology", { label: "Bare topic" });
    delete bare.wrong;
    delete bare.correct;
    const { page } = await renderToday({
      ...WITH_READING,
      study_today: todayBy(
        () => payload([row("cell-biology")], { weak_topics: [bare as WeakTopic] }),
        EMPTY,
      ),
    });
    const topics = within(page).getByTestId("today-weak");
    expect(await within(topics).findByText("Bare topic")).toBeInTheDocument();
    expect(within(topics).getByRole("button", { name: "Drill Bare topic" })).toBeInTheDocument();
    expect(topics).not.toHaveTextContent(/undefined|NaN/);
  });

  it("Your classes has a card per class from both libraries, with lectures, cards due and % mastered", async () => {
    const { page } = await renderToday();
    const classes = within(page).getByTestId("today-classes");
    const cell = await within(classes).findByRole("button", { name: /Cell Biology/ });
    expect(cell).toHaveTextContent("14 lectures · 18 cards due");
    expect(cell).toHaveTextContent("82% mastered");
    expect(within(classes).getByRole("button", { name: /Linear Algebra/ })).toHaveTextContent(
      "9 lectures · no cards due",
    );
    expect(within(classes).getByRole("button", { name: /Collab Notes/ })).toHaveTextContent(
      "3 lectures · 8 cards due",
    );
    expect(within(classes).getAllByRole("button")).toHaveLength(4);
  });

  it("a class card in the library that is not active switches library, then opens that class", async () => {
    const user = userEvent.setup();
    const savePayloads: unknown[] = [];
    // Settings that keep what was saved, so the library switch really changes the active library.
    let current = fixtureSettings;
    const { page, router } = await renderToday({
      ...WITH_READING,
      get_settings: () => current,
      save_settings: (args) => {
        savePayloads.push(args);
        current = (args as { settings: typeof fixtureSettings }).settings;
        return null;
      },
    });
    const classes = within(page).getByTestId("today-classes");
    await user.click(await within(classes).findByRole("button", { name: /Collab Notes/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/collab-notes/overview");
    });
    const saved = (savePayloads[0] as { settings: { active_root: string } }).settings;
    expect(saved.active_root).toBe(FIXTURE_ROOT_SHARED);
    // Wait for the class view itself: only once it has rendered can "Class not found" be ruled out.
    await waitFor(() => {
      expect(screen.getAllByText("Course overview").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Class not found")).not.toBeInTheDocument();
  });

  describe("Start review", () => {
    it("opens Practice > Cards of the class with the nearest exam, among classes with due cards", async () => {
      const user = userEvent.setup();
      const { page, router } = await renderToday();
      await user.click(await within(page).findByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/practice/cards");
      });
    });

    it("opens Cards on Due today from the first due card, not on the deck mode the class was left in", async () => {
      const user = userEvent.setup();
      // The class was left on Full deck, mid-deck (the default mock deck is fc-1..fc-86).
      const ids = Array.from({ length: 86 }, (_, i) => `fc-${i + 1}`);
      useStudySessionStore.setState({
        sessions: {
          [studySessionKey(FIXTURE_ROOT_FALL, "organic-chemistry-ii", "flashcards")]: {
            identity: `${FIXTURE_ROOT_FALL}|organic-chemistry-ii:${ids.join("\0")}`,
            savedAt: Date.now(),
            deckMode: "full",
            cardIds: ids,
            index: 40,
            flipped: false,
          },
        },
      });
      const { page, router } = await renderToday();
      await user.click(await within(page).findByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/practice/cards");
      });
      const dueTab = await screen.findByRole("tab", { name: /Due today/i }, { timeout: 8000 });
      await waitFor(() => expect(dueTab).toHaveAttribute("aria-selected", "true"));
      expect(await screen.findByText("1 / 14")).toBeInTheDocument();
    });

    it("opens the class's whole due deck, dropping lectures ticked there earlier", async () => {
      const user = userEvent.setup();
      const key = classScopeKey(FIXTURE_ROOT_FALL, "organic-chemistry-ii");
      useLectureSelectionStore.getState().setScope(key, ["organic-chemistry-ii/digests/old-pick.md"]);
      const { page, router } = await renderToday();
      await user.click(await within(page).findByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/practice/cards");
      });
      expect(useLectureSelectionStore.getState().byClass[key] ?? []).toEqual([]);
    });

    it("skips a class that is nearest to its exam but has nothing due", async () => {
      const user = userEvent.setup();
      const { page, router } = await renderToday({
        ...WITH_READING,
        study_today: todayBy(
          payload([
            row("organic-chemistry-ii", { due_ids: [], exam_date: "2026-11-16", days_to_exam: 9 }),
            row("cell-biology", { due_ids: due("cb", 4), exam_date: "2026-12-20", days_to_exam: 36 }),
            row("linear-algebra", { due_ids: due("la", 9) }),
          ]),
          EMPTY,
        ),
      });
      await user.click(await within(page).findByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/cell-biology/practice/cards");
      });
    });

    it("falls back to the class with the most due cards when none has an exam", async () => {
      const user = userEvent.setup();
      const { page, router } = await renderToday({
        ...WITH_READING,
        study_today: todayBy(
          payload([row("cell-biology", { due_ids: due("cb", 4) }), row("linear-algebra", { due_ids: due("la", 9) })]),
          EMPTY,
        ),
      });
      await user.click(await within(page).findByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/linear-algebra/practice/cards");
      });
    });

    it("opens a class in the other library through the library switch", async () => {
      const user = userEvent.setup();
      const { page, router } = await renderToday({
        ...WITH_READING,
        study_today: todayBy(payload([row("cell-biology", { due_ids: [] })]), SHARED_TODAY),
      });
      await user.click(await within(page).findByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/collab-notes/practice/cards");
      });
      expect(getMockIpcLog()).toContain("save_settings");
    });

    it("decides on fresh counts: a class whose cards were just reviewed is not opened on a stale count", async () => {
      const user = userEvent.setup();
      // The first answer is what the page shows; by the time of the click the exam class has
      // been reviewed and the worker answers 0 due (the 2 s refresh debounce has not fired yet).
      let calls = 0;
      const fall = () => {
        calls += 1;
        const examDue = calls === 1 ? 6 : 0;
        return payload([
          row("organic-chemistry-ii", { due_ids: due("oc", examDue), exam_date: "2026-11-16", days_to_exam: 9 }),
          row("cell-biology", { due_ids: due("cb", 3), exam_date: "2026-12-20", days_to_exam: 36 }),
        ]);
      };
      const { page, router, queryClient } = await renderToday({
        ...WITH_READING,
        study_today: todayBy(fall, EMPTY),
      });
      const review = within(page).getByTestId("today-review");
      await within(review).findByText("9 cards");
      await user.click(within(review).getByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/cell-biology/practice/cards");
      });
      // The refetch also corrected Today's own data (the page itself is gone by now).
      const cached = queryClient.getQueryData<TodayPayload>(qk.todayRoot(FIXTURE_ROOT_FALL));
      expect(cached?.courses.find((c) => c.course === "organic-chemistry-ii")?.due_ids).toEqual([]);
    });

    it("considers a class that became due since the last fetch, and picks it by its exam", async () => {
      const user = userEvent.setup();
      // On screen A has nothing due and B has 5; by the click A has 3 due and the nearest exam.
      let clicked = false;
      const fall = () =>
        payload([
          row("organic-chemistry-ii", {
            due_ids: due("oc", clicked ? 3 : 0),
            exam_date: "2026-11-16",
            days_to_exam: 2,
          }),
          row("cell-biology", { due_ids: due("cb", 5) }),
        ]);
      const { page, router } = await renderToday({
        ...WITH_READING,
        study_today: todayBy(fall, EMPTY),
      });
      const review = within(page).getByTestId("today-review");
      await within(review).findByText("5 cards");
      clicked = true;
      await user.click(within(review).getByRole("button", { name: "Start review" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/practice/cards");
      });
    });

    it("says Nothing due, with no Start review, when no class has cards due", async () => {
      const { page } = await renderToday({
        ...WITH_READING,
        study_today: todayBy(payload([row("cell-biology", { due_ids: [] })]), EMPTY),
      });
      const review = within(page).getByTestId("today-review");
      expect(await within(review).findByText("Nothing due")).toBeInTheDocument();
      expect(within(review).queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
    });
  });

  it("shows an inline error for a failing library and still renders the others", async () => {
    const { page } = await renderToday({
      ...WITH_READING,
      study_today: todayBy(FALL_TODAY, () => {
        throw new Error("worker exited with code 2");
      }),
    });
    const alert = await within(page).findByRole("alert");
    expect(alert).toHaveTextContent("Shared · Study group");
    expect(alert).toHaveTextContent("worker exited with code 2");
    const classes = within(page).getByTestId("today-classes");
    expect(within(classes).getByRole("button", { name: /Cell Biology/ })).toBeInTheDocument();
    expect(within(classes).queryByRole("button", { name: /Collab Notes/ })).not.toBeInTheDocument();
    expect(within(page).getByText("33 cards")).toBeInTheDocument();
  });

  it("does not wait for a slow library: the others show and it is named as still loading", async () => {
    const { page } = await renderToday({
      ...WITH_READING,
      study_today: todayBy(FALL_TODAY, () => new Promise<TodayPayload>(() => undefined)),
    });
    const classes = within(page).getByTestId("today-classes");
    expect(await within(classes).findByRole("button", { name: /Cell Biology/ })).toBeInTheDocument();
    expect(within(page).getByText(/Still loading Shared · Study group/)).toBeInTheDocument();
  });

  it("shows empty cards instead of numbers when nothing has been answered yet", async () => {
    const { page } = await renderToday({
      ...WITH_READING,
      study_today: todayBy(payload([row("cell-biology", { due_ids: [], mastery: null })]), EMPTY),
      list_digests: () => [],
      read_reading_state: () => ({}),
    });
    expect(await within(page).findByText("Nothing due")).toBeInTheDocument();
    expect(within(page).getByText("No exam set")).toBeInTheDocument();
    expect(within(page).getByText("No quiz answers this week")).toBeInTheDocument();
    expect(within(page).getByText("Nothing to read yet")).toBeInTheDocument();
    expect(within(page).getByText("No weak topics")).toBeInTheDocument();
  });

  describe("with no library", () => {
    it("shows First run at /, not a redirect, with the three steps", async () => {
      const { router } = await renderAppAtRoute("/", { get_settings: NO_LIBRARY });
      expect(await screen.findByRole("heading", { name: "Welcome to Arbor" })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
      expect(screen.getByRole("heading", { name: "Choose a Knowledge folder" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Add a class and its lectures" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Update knowledge" })).toBeInTheDocument();
      expect(screen.getByTestId("welcome-choose-folder")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join a shared library" })).toBeInTheDocument();
      expect(screen.queryByTestId("today-page")).not.toBeInTheDocument();
      expect(getMockIpcLog()).not.toContain("study_today");
    });

    it("shows an error with a retry, not First run, when settings cannot be read", async () => {
      const user = userEvent.setup();
      let failing = true;
      await renderAppAtRoute("/", {
        get_settings: () => {
          if (failing) {
            throw new Error("settings.json is unreadable");
          }
          return fixtureSettings;
        },
        ...WITH_READING,
      });
      // The query retries once before it gives up.
      const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
      expect(alert).toHaveTextContent("settings.json is unreadable");
      expect(screen.queryByRole("heading", { name: "Welcome to Arbor" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("first-run")).not.toBeInTheDocument();

      failing = false;
      await user.click(within(alert).getByRole("button", { name: "Retry" }));
      expect(await screen.findByTestId("today-page")).toBeInTheDocument();
    });
  });
});
