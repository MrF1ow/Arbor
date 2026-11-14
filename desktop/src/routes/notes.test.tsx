import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import overviewSource from "~/components/notes/course-overview.tsx?raw";
import overviewRoute from "~/routes/course.$course.overview.tsx?raw";
import readRoute from "~/routes/course.$course.read.$digest.tsx?raw";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import {
  FIXTURE_ROOT_FALL,
  fixtureCourseOverview,
  fixtureSettings,
} from "~/test/fixtures/data";
import { designCourseStats } from "~/test/fixtures/design";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { useJobStore } from "~/stores/job-store";
import { classScopeKey, useLectureSelectionStore } from "~/stores/lecture-selection-store";
import { useSelectionStore } from "~/stores/selection-store";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

const COURSE = "cell-biology";
const SCOPE_KEY = classScopeKey(FIXTURE_ROOT_FALL, COURSE);

/** Seven lectures in three units, with every badge kind and both Weak routes (Q25, Q26). */
const LECTURES = [
  { title: "Cell theory", date: "2026-09-02", unit: "Foundations", slug: "cell-theory" },
  { title: "Cytoskeleton", date: "2026-09-11", unit: "Foundations", slug: "cytoskeleton" },
  { title: "Lipid bilayers", date: "2026-10-01", unit: "Membranes", slug: "lipid-bilayers" },
  { title: "Membrane transport", date: "2026-10-08", unit: "Membranes", slug: "membrane-transport" },
  { title: "Cell signalling", date: "2026-10-13", unit: "Membranes", slug: "cell-signalling" },
  { title: "Cell cycle", date: "2026-10-27", unit: "Division", slug: "cell-cycle" },
  { title: "Apoptosis", date: "2026-11-03", unit: "Division", slug: "apoptosis" },
].map((l) => ({ ...l, file: `${l.date}-${l.slug}.md` }));

const digestInfos = LECTURES.map((l) => ({
  title: l.title,
  date: l.date,
  path: `${COURSE}/digests/${l.file}`,
  unit: l.unit,
  source_path: `${COURSE}/${l.unit}/${l.slug}.pdf`,
})).sort((a, b) => b.path.localeCompare(a.path));

const stat = (
  cards: number,
  due: number,
  mastery: number | null,
  quiz: [number, number],
  deck: [number, number],
) => ({
  cards,
  due,
  mastered: 0,
  mastery,
  quiz_correct: quiz[0],
  quiz_wrong: quiz[1],
  card_correct: deck[0],
  card_wrong: deck[1],
});

const digestStats = {
  "digests/2026-09-02-cell-theory.md": stat(12, 0, 0.95, [6, 0], [10, 0]),
  // 6 of 10 answers wrong, with cards: Weak, red 64%.
  "digests/2026-09-11-cytoskeleton.md": stat(12, 5, 0.64, [1, 3], [3, 3]),
  "digests/2026-10-01-lipid-bilayers.md": stat(12, 2, 0.92, [7, 0], [11, 1]),
  // Weak from quiz answers alone and no cards: never a % badge.
  "digests/2026-10-08-membrane-transport.md": stat(0, 0, null, [5, 5], [0, 0]),
};

const readingState = {
  [`${COURSE}/digests/2026-10-13-cell-signalling.md`]: {
    fraction: 0.4,
    last_opened: "2026-10-14T09:00:00Z",
    read: false,
  },
  [`${COURSE}/digests/2026-10-27-cell-cycle.md`]: {
    fraction: 1,
    last_opened: "2026-10-28T09:00:00Z",
    read: true,
  },
};

function studyProgress(args?: unknown) {
  const action = (args as { action?: string }).action;
  if (action === "digest-stats") {
    return { digests: digestStats };
  }
  if (action === "overview") {
    return fixtureCourseOverview;
  }
  if (action === "stats") {
    return designCourseStats("Cell Biology");
  }
  return {};
}

const workspaceFixtures = {
  list_digests: () => digestInfos,
  // The class's saved exam date: the only source of the date (the plan's own text is not one).
  read_course_meta: () => ({ [COURSE]: { exam_date: "2026-11-04" } }),
  study_progress: studyProgress,
  read_reading_state: () => readingState,
};

function rows() {
  return screen.getAllByTestId("lecture-row");
}

function rowTitles() {
  return rows().map((row) => within(row).getByRole("button", { name: /^(?!Select)/ }).textContent);
}

async function waitForOverview() {
  await waitFor(
    () => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
      expect(screen.getByText("Cards due today")).toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

async function waitForColumn() {
  await waitFor(() => expect(screen.getAllByTestId("lecture-row")).toHaveLength(7), {
    timeout: 5000,
  });
}

async function waitForDigestArticle() {
  await waitFor(() => expect(screen.getByTestId("digest-view")).toBeInTheDocument(), {
    timeout: 5000,
  });
  await waitFor(
    () => {
      const article = screen.getByRole("article");
      expect(article.textContent).toContain("Membrane structure");
    },
    { timeout: 5000 },
  );
}

function selectFirstParagraph() {
  const paragraph = screen.getByRole("article").querySelector("p");
  expect(paragraph).toBeTruthy();
  const range = document.createRange();
  range.selectNodeContents(paragraph!);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("lecture selection store", () => {
  const KEY = classScopeKey("/lib", COURSE);
  const A = `${COURSE}/digests/a.md`;
  const B = `${COURSE}/digests/b.md`;
  beforeEach(() => useLectureSelectionStore.setState({ byClass: {} }));

  it("ticks and unticks a lecture per class", () => {
    const { toggle } = useLectureSelectionStore.getState();
    toggle(KEY, A);
    toggle(KEY, B);
    expect(useLectureSelectionStore.getState().byClass[KEY]).toEqual([A, B]);
    toggle(KEY, A);
    expect(useLectureSelectionStore.getState().byClass[KEY]).toEqual([B]);
  });

  it("keeps each class's ticks apart, even for the same class name in two libraries", () => {
    useLectureSelectionStore.getState().toggle(KEY, A);
    expect(useLectureSelectionStore.getState().byClass[classScopeKey("/shared", COURSE)]).toBeUndefined();
  });

  it("setScope replaces the ticks and de-duplicates; clear drops the class", () => {
    const { setScope, clear } = useLectureSelectionStore.getState();
    setScope(KEY, [A, B, A]);
    expect(useLectureSelectionStore.getState().byClass[KEY]).toEqual([A, B]);
    clear(KEY);
    expect(useLectureSelectionStore.getState().byClass[KEY]).toBeUndefined();
  });
});

/** Run `fn` with every observed element reporting `width` px, so the workspace picks column or sheet. */
async function atWorkspaceWidth(width: number, fn: () => Promise<void>) {
  const OriginalRO = globalThis.ResizeObserver;
  class MockResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
      this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect() {}
    unobserve() {}
  }
  globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
  try {
    await fn();
  } finally {
    globalThis.ResizeObserver = OriginalRO;
  }
}

describe("class workspace", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: true,
      logOpen: false,
      logHeight: 200,
      lastCourse: null,
    });
    useLectureSelectionStore.setState({ byClass: {} });
    useSelectionStore.getState().clearSelection();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
    clearMockIpcLog();
  });

  afterEach(() => {
    cleanup();
    resetMockHandlerTimers();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  describe("lecture column", () => {
    it("a class opens on Overview", async () => {
      const { router } = await renderAppAtRoute(`/course/${COURSE}`, workspaceFixtures);
      await waitForOverview();
      expect(router.state.location.pathname).toBe(`/course/${COURSE}/overview`);
      expect(screen.getByRole("button", { name: /Course map · study plan/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("groups lectures by unit, newest unit first, with titles only", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      const column = screen.getByRole("navigation", { name: "Lectures" });
      const units = within(column)
        .getAllByTestId("lecture-unit")
        .map((el) => el.textContent);
      expect(units).toEqual(["Division", "Membranes", "Foundations"]);
      expect(rowTitles()).toEqual([
        "Cell cycle",
        "Apoptosis",
        "Lipid bilayers",
        "Membrane transport",
        "Cell signalling",
        "Cell theory",
        "Cytoskeleton",
      ]);
      expect(within(column).queryByText(/\bL\d/)).not.toBeInTheDocument();
    });

    it("shows the badge kinds: red % only when Weak, Weak for quiz-only, New, Unread, none", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      const badge = (title: string) => {
        const row = rows().find((r) => within(r).queryByRole("button", { name: title }));
        return row ? within(row).queryByTestId("lecture-badge") : null;
      };
      const good = badge("Cell theory")!;
      expect(good).toHaveTextContent("95%");
      expect(good).toHaveAttribute("data-tone", "good");
      const weakMastery = badge("Cytoskeleton")!;
      expect(weakMastery).toHaveTextContent("64%");
      expect(weakMastery).toHaveAttribute("data-tone", "weak");
      // No cards, so no % badge; the row is marked Weak instead of being left plain (Q26).
      const weakNoCards = badge("Membrane transport")!;
      expect(weakNoCards).toHaveTextContent("Weak");
      expect(weakNoCards).toHaveAttribute("data-tone", "weak");
      expect(badge("Apoptosis")).toHaveTextContent("New");
      expect(badge("Cell signalling")).toHaveTextContent("Unread");
      expect(badge("Cell cycle")).toBeNull();
    });

    it("filter chips count and filter the lectures", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      expect(screen.getByRole("button", { name: "All 7" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Unread 6" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Weak 2" }));
      expect(rowTitles()).toEqual(["Membrane transport", "Cytoskeleton"]);
      await user.click(screen.getByRole("button", { name: "Due 2" }));
      expect(rowTitles()).toEqual(["Lipid bilayers", "Cytoskeleton"]);
      await user.click(screen.getByRole("button", { name: "Unread 6" }));
      expect(rows()).toHaveLength(6);
      expect(rowTitles()).not.toContain("Cell cycle");
    });

    it("ticking two lectures shows the tray, and Clear removes it", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      expect(screen.queryByRole("region", { name: "Selected lectures" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "Select Cell theory" }));
      expect(screen.getByText("1 lecture selected")).toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "Select Lipid bilayers" }));
      const tray = screen.getByRole("region", { name: "Selected lectures" });
      expect(within(tray).getByText("2 lectures selected")).toBeInTheDocument();
      expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([
        `${COURSE}/digests/2026-09-02-cell-theory.md`,
        `${COURSE}/digests/2026-10-01-lipid-bilayers.md`,
      ]);
      await user.click(within(tray).getByRole("button", { name: "Clear" }));
      expect(screen.queryByRole("region", { name: "Selected lectures" })).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Select Cell theory" })).not.toBeChecked();
    });

    it("the tray opens Flashcards, Quiz, Ask and Map, keeping the ticked lectures as the scope", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/read/2026-09-02-cell-theory`, workspaceFixtures);
      await waitForColumn();
      await user.click(screen.getByRole("checkbox", { name: "Select Cell theory" }));
      const tray = () => screen.getByRole("region", { name: "Selected lectures" });
      const go = async (name: string, path: string) => {
        await user.click(within(tray()).getByRole("button", { name }));
        await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/${path}`));
      };
      await go("Show on map", "map");
      await go("Ask about these", "ask");
      await go("Quiz me", "practice/quiz");
      // Practice has no tray (its scope chip stands in for it): go back to Read for the last button.
      await router.navigate({ to: "/course/$course/read/$digest", params: { course: COURSE, digest: "2026-09-02-cell-theory" } });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/read/2026-09-02-cell-theory`));
      await go("Flashcards", "practice/cards");
      expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([
        `${COURSE}/digests/2026-09-02-cell-theory.md`,
      ]);
    });

    it("a ?lectures= link ticks those lectures", async () => {
      const lectures = encodeURIComponent(`${COURSE}/digests/2026-10-08-membrane-transport.md`);
      await renderAppAtRoute(`/course/${COURSE}/practice/quiz?lectures=${lectures}`, workspaceFixtures);
      await waitFor(() =>
        expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([
          `${COURSE}/digests/2026-10-08-membrane-transport.md`,
        ]),
      );
    });

    it("a ?lectures= link in the digests/ form ticks the same lecture", async () => {
      const lectures = encodeURIComponent("digests/2026-10-08-membrane-transport.md");
      await renderAppAtRoute(`/course/${COURSE}/overview?lectures=${lectures}`, workspaceFixtures);
      await waitFor(() =>
        expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([
          `${COURSE}/digests/2026-10-08-membrane-transport.md`,
        ]),
      );
    });

    it("applies ?lectures= once per navigation: Back does not re-tick what the user cleared (A2)", async () => {
      const lipid = `${COURSE}/digests/2026-10-01-lipid-bilayers.md`;
      const { router } = await renderAppAtRoute(
        `/course/${COURSE}/practice/quiz?lectures=${encodeURIComponent(lipid)}`,
        workspaceFixtures,
      );
      await waitFor(() => expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([lipid]));
      useLectureSelectionStore.getState().clear(SCOPE_KEY);
      await router.navigate({ to: "/course/$course/practice/cards", params: { course: COURSE } });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/practice/cards`));
      router.history.back();
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/practice/quiz`));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toBeUndefined();
      expect(router.state.location.search).toEqual({});
      // A fresh link to the same URL is a new navigation and applies again.
      await router.navigate({
        to: "/course/$course/practice/quiz",
        params: { course: COURSE },
        search: { lectures: encodeURIComponent(lipid) },
      });
      await waitFor(() => expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([lipid]));
    });

    it("+ Add files imports into a class that already has digests", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        "plugin:dialog|open": () => ["/tmp/lecture-9.pdf"],
      });
      await waitForColumn();
      await user.click(screen.getByRole("button", { name: "+ Add files" }));
      await waitFor(() => expect(getMockIpcLog()).toContain("import_sources"));
      const call = getMockIpcCalls().find((c) => c.cmd === "import_sources");
      expect(call?.args).toMatchObject({ course: COURSE, paths: ["/tmp/lecture-9.pdf"] });
    });

    it("+ Add files is disabled for viewers", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        library_show: () => ({
          present: true,
          name: "Shared",
          created_by: "a@example.com",
          members: [],
          provider: null,
          role: "viewer",
        }),
      });
      await waitForColumn();
      await waitFor(() => expect(screen.getByRole("button", { name: "+ Add files" })).toBeDisabled());
    });

    it("clicking a lecture opens it in Read and marks the row current", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      await user.click(screen.getByRole("button", { name: "Lipid bilayers" }));
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/course/${COURSE}/read/2026-10-01-lipid-bilayers`),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Lipid bilayers" })).toHaveAttribute("aria-current", "page"),
      );
    });
  });

  describe("class header", () => {
    it("the Read, Practice, Map and Ask tabs and the Overview row navigate by click", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      const tabs = () => screen.getByRole("navigation", { name: "Class views" });
      const path = () => router.state.location.pathname;

      await user.click(within(tabs()).getByRole("link", { name: "Read" }));
      await waitFor(() => expect(path()).toMatch(new RegExp(`^/course/${COURSE}/read/`)));
      expect(within(tabs()).getByRole("link", { name: "Read" })).toHaveAttribute("aria-current", "page");

      await user.click(within(tabs()).getByRole("link", { name: "Map" }));
      await waitFor(() => expect(path()).toBe(`/course/${COURSE}/map`));

      await user.click(screen.getByRole("button", { name: /Course map · study plan/ }));
      await waitFor(() => expect(path()).toBe(`/course/${COURSE}/overview`));

      await user.click(within(tabs()).getByRole("link", { name: "Practice" }));
      await waitFor(() => expect(path()).toBe(`/course/${COURSE}/practice/cards`));

      await user.click(within(tabs()).getByRole("link", { name: "Ask" }));
      await waitFor(() => expect(path()).toBe(`/course/${COURSE}/ask`));
    });

    it("Read opens the lecture you were last in, not the first one", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      await user.click(
        within(screen.getByRole("navigation", { name: "Class views" })).getByRole("link", { name: "Read" }),
      );
      // Cell cycle was opened most recently in the reading state.
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/course/${COURSE}/read/2026-10-27-cell-cycle`),
      );
    });

    it("/map, /practice and /ask render inside the workspace; Practice hides the lecture column", async () => {
      const mapRender = await renderAppAtRoute(`/course/${COURSE}/map`, workspaceFixtures);
      await screen.findByTestId("graph-view");
      expect(screen.getByRole("navigation", { name: "Class views" })).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Lectures" })).toBeInTheDocument();
      mapRender.unmount();

      const cards = await renderAppAtRoute(`/course/${COURSE}/practice/cards`, workspaceFixtures);
      await screen.findByText(/Due today/i);
      expect(screen.getByRole("navigation", { name: "Class views" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Lectures" })).not.toBeInTheDocument();
      cards.unmount();

      const quiz = await renderAppAtRoute(`/course/${COURSE}/practice/quiz`, workspaceFixtures);
      await screen.findByTestId("quiz-card", undefined, { timeout: 5000 });
      expect(screen.queryByRole("navigation", { name: "Lectures" })).not.toBeInTheDocument();
      quiz.unmount();

      await renderAppAtRoute(`/course/${COURSE}/ask`, workspaceFixtures);
      await screen.findByTestId("chat-view");
      expect(screen.getByRole("navigation", { name: "Class views" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Lectures" })).not.toBeInTheDocument();
    });

    it("Practice shows the scope chip and its × clears the ticked lectures", async () => {
      const user = userEvent.setup();
      useLectureSelectionStore.getState().setScope(SCOPE_KEY, [
        `${COURSE}/digests/2026-10-01-lipid-bilayers.md`,
        `${COURSE}/digests/2026-10-08-membrane-transport.md`,
        `${COURSE}/digests/2026-10-13-cell-signalling.md`,
      ]);
      await renderAppAtRoute(`/course/${COURSE}/practice/cards`, workspaceFixtures);
      const chip = await screen.findByRole("button", { name: /Stop studying Membranes · 3 lectures/ });
      expect(chip).toHaveTextContent("Membranes · 3 lectures");
      await user.click(chip);
      expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toBeUndefined();
    });

    it("shows no selection tray on Practice, where the scope chip stands in for it", async () => {
      useLectureSelectionStore.getState().setScope(SCOPE_KEY, [
        `${COURSE}/digests/2026-10-01-lipid-bilayers.md`,
        `${COURSE}/digests/2026-10-08-membrane-transport.md`,
      ]);
      await renderAppAtRoute(`/course/${COURSE}/practice/cards`, workspaceFixtures);
      await screen.findByRole("button", { name: /Stop studying/ });
      expect(screen.queryByRole("region", { name: "Selected lectures" })).not.toBeInTheDocument();
    });

    it("opens the lecture list as a sheet when the window is narrow", async () => {
      const OriginalRO = globalThis.ResizeObserver;
      class MockResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(el: Element) {
          Object.defineProperty(el, "clientWidth", { configurable: true, value: 500 });
          this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        disconnect() {}
        unobserve() {}
      }
      globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
      const user = userEvent.setup();
      try {
        await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
        await waitForOverview();
        expect(screen.queryByRole("navigation", { name: "Lectures" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Show lectures" }));
        await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
        await waitFor(() => expect(within(screen.getByRole("dialog")).getAllByTestId("lecture-row")).toHaveLength(7));
      } finally {
        globalThis.ResizeObserver = OriginalRO;
      }
    });
    it("hides the selection tray while the lecture sheet is open, so it never covers the sheet's rows", async () => {
      const OriginalRO = globalThis.ResizeObserver;
      class MockResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(el: Element) {
          Object.defineProperty(el, "clientWidth", { configurable: true, value: 500 });
          this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        disconnect() {}
        unobserve() {}
      }
      globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
      const user = userEvent.setup();
      try {
        await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
        await waitForOverview();
        await user.click(screen.getByRole("button", { name: "Show lectures" }));
        const sheet = await screen.findByRole("dialog");
        const boxes = await within(sheet).findAllByRole("checkbox");
        await user.click(boxes[0]!);
        // The modal sheet hides the page from role queries, so look past aria-hidden.
        expect(screen.queryByRole("region", { name: "Selected lectures", hidden: true })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getByRole("region", { name: "Selected lectures" })).toBeInTheDocument();
      } finally {
        globalThis.ResizeObserver = OriginalRO;
      }
    });
  });

  describe("lecture column per class and in the sheet", () => {
    it("C19: the filter resets when another class opens", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      await user.click(screen.getByRole("button", { name: /^Weak/ }));
      expect(screen.getByRole("button", { name: /^Weak/ })).toHaveAttribute("aria-pressed", "true");
      await router.navigate({ to: "/course/$course/overview", params: { course: "linear-algebra" } });
      await waitFor(() => expect(router.state.location.pathname).toBe("/course/linear-algebra/overview"));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^Weak/ })).toHaveAttribute("aria-pressed", "false"),
      );
      expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("C18: in the sheet the column header leaves room for the Close button, and a column does not", async () => {
      await atWorkspaceWidth(500, async () => {
        const user = userEvent.setup();
        await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
        await waitForOverview();
        await user.click(screen.getByRole("button", { name: "Show lectures" }));
        const dialog = await screen.findByRole("dialog");
        const header = within(dialog).getByTestId("lecture-column-header");
        expect(header.className).toMatch(/\bpr-12\b/);
        expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
      });
      cleanup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForColumn();
      expect(screen.getByTestId("lecture-column-header").className).not.toMatch(/\bpr-12\b/);
    });
  });

  describe("layout rules", () => {
    it("uses the 960 px sheet breakpoint for Read only, and 704 for Overview and Map (F81)", async () => {
      const READ_PATH = `/course/${COURSE}/read/2026-10-08-membrane-transport`;
      const hasColumn = () => screen.queryByRole("navigation", { name: "Lectures" }) !== null;
      const hasSheetButton = () => screen.queryByRole("button", { name: "Show lectures" }) !== null;
      await atWorkspaceWidth(1000, async () => {
        await renderAppAtRoute(READ_PATH, workspaceFixtures);
        await waitForDigestArticle();
        expect(hasColumn()).toBe(true);
        expect(hasSheetButton()).toBe(false);
      });
      cleanup();
      await atWorkspaceWidth(900, async () => {
        await renderAppAtRoute(READ_PATH, workspaceFixtures);
        await waitForDigestArticle();
        expect(hasColumn()).toBe(false);
        expect(hasSheetButton()).toBe(true);
      });
      for (const view of ["overview", "map"]) {
        cleanup();
        await atWorkspaceWidth(788, async () => {
          await renderAppAtRoute(`/course/${COURSE}/${view}`, workspaceFixtures);
          await waitFor(() => expect(hasColumn()).toBe(true), { timeout: 5000 });
          expect(hasSheetButton()).toBe(false);
        });
        cleanup();
        await atWorkspaceWidth(700, async () => {
          await renderAppAtRoute(`/course/${COURSE}/${view}`, workspaceFixtures);
          await waitFor(() => expect(hasSheetButton()).toBe(true), { timeout: 5000 });
          expect(hasColumn()).toBe(false);
        });
      }
    });

    it("measures the Overview grids against the Overview pane, not the whole workspace", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const pane = screen.getByTestId("overview-pane");
      expect(pane).toHaveClass("@container/overview");
      expect(overviewSource).not.toContain("notes-main");
    });

    it("sizes the tray 645 x 45, 35 px above the bottom, and never wider than the workspace", async () => {
      useLectureSelectionStore.getState().setScope(SCOPE_KEY, [`${COURSE}/digests/2026-10-08-membrane-transport.md`]);
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const tray = await screen.findByRole("region", { name: "Selected lectures" });
      for (const cls of ["w-161.25", "min-h-11.25", "bottom-8.75", "max-w-full", "flex-wrap"]) {
        expect(tray).toHaveClass(cls);
      }
    });

    it("the overview and read routes import the page components, not each other's route files", () => {
      const sources = { overviewRoute, readRoute };
      for (const [name, source] of Object.entries(sources)) {
        expect(source, name).not.toMatch(/from "~\/routes\/course\.\$course\.(overview|read)/);
      }
    });

    it("heads Overview with the class, its lecture count and the exam date", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      expect(screen.getByText("Cell Biology · 7 lectures · exam Nov 4")).toBeInTheDocument();
    });
  });

  describe("overview", () => {
    it("shows the stat cards, study plan, weak topics and recommendations", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      expect(screen.getByText("14 cards")).toBeInTheDocument();
      expect(screen.getByText("Quiz accuracy")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Study plan" })).toBeInTheDocument();
      expect(await screen.findByText("3 of 6 done")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Weak topics" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Recommended" })).toBeInTheDocument();
      expect(screen.getByText(/Exam/)).toBeInTheDocument();
    });

    it("the study plan checkbox calls study_plan_toggle", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const box = await screen.findByRole("checkbox", { name: "Review weak topics" });
      expect(box).not.toBeChecked();
      await user.click(box);
      await waitFor(() => expect(getMockIpcLog()).toContain("study_plan_toggle"));
      const call = getMockIpcCalls().find((c) => c.cmd === "study_plan_toggle");
      expect(call?.args).toMatchObject({ course: COURSE, task: "0a1b2c3d05", done: true });
      await waitFor(() => expect(screen.getByText("4 of 6 done")).toBeInTheDocument());
    });

    it("lets a viewer tick the study plan (PR 138)", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        library_show: () => ({
          present: true,
          name: "Shared",
          created_by: "a@example.com",
          members: [],
          provider: null,
          role: "viewer",
        }),
      });
      await waitForOverview();
      await user.click(await screen.findByRole("checkbox", { name: "Review weak topics" }));
      await waitFor(() => expect(getMockIpcLog()).toContain("study_plan_toggle"));
    });

    it("editing the exam date calls set_course_meta with examDate once, on blur", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      // Typing the year in a date input passes through 0002, 0020, 0202 before 2027.
      for (const value of ["0002-12-01", "0020-12-01", "0202-12-01", "2027-12-01"]) {
        fireEvent.change(input, { target: { value } });
      }
      expect(input).toHaveValue("2027-12-01");
      expect(getMockIpcLog()).not.toContain("set_course_meta");
      fireEvent.blur(input);
      await waitFor(() => expect(getMockIpcLog()).toContain("set_course_meta"));
      const calls = getMockIpcCalls().filter((c) => c.cmd === "set_course_meta");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toMatchObject({ course: COURSE, examDate: "2027-12-01" });
      // Only the exam date goes out, so the class's icon and colour are left alone.
      expect(Object.keys(calls[0]?.args as object).sort()).toEqual(["course", "examDate", "root"]);
    });

    it("Enter saves the exam date, and a date that did not change is not written", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2026-11-04"));
      fireEvent.blur(input);
      fireEvent.change(input, { target: { value: "2026-12-02" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(getMockIpcLog()).toContain("set_course_meta"));
      fireEvent.blur(input);
      const calls = getMockIpcCalls().filter((c) => c.cmd === "set_course_meta");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toMatchObject({ examDate: "2026-12-02" });
    });

    it("clearing the exam date clears it", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2026-11-04"));
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      await waitFor(() => expect(getMockIpcLog()).toContain("set_course_meta"));
      const call = getMockIpcCalls().find((c) => c.cmd === "set_course_meta");
      expect(call?.args).toMatchObject({ examDate: "" });
    });

    it.each([
      ["a partial year", "0002-12-01"],
      ["a year before 1900", "1899-12-31"],
      ["a year after 2100", "2101-01-01"],
    ])("does not save %s: it keeps the draft and shows it invalid (F83)", async (_name, value) => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2026-11-04"));
      fireEvent.change(input, { target: { value } });
      expect(input).not.toHaveAttribute("aria-invalid", "true");
      fireEvent.blur(input);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(/full date/i);
      expect(input).toHaveValue(value);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(getMockIpcLog()).not.toContain("set_course_meta");
      // A valid date clears the complaint and saves.
      fireEvent.change(input, { target: { value: "2027-12-01" } });
      expect(input).not.toHaveAttribute("aria-invalid", "true");
      fireEvent.blur(input);
      await waitFor(() => expect(getMockIpcLog()).toContain("set_course_meta"));
    });

    it("an unfinished date picker (empty value, badInput) is not a clear (F83)", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2026-11-04"));
      Object.defineProperty(input, "validity", { configurable: true, value: { badInput: true } });
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(getMockIpcLog()).not.toContain("set_course_meta");
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("shows an error when the exam date write fails, and a second blur retries it (F83)", async () => {
      let attempts = 0;
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        set_course_meta: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("disk full");
          }
          return {};
        },
      });
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      fireEvent.change(input, { target: { value: "2027-12-01" } });
      fireEvent.blur(input);
      expect(await screen.findByRole("alert")).toHaveTextContent(/could not save the exam date/i);
      expect(input).toHaveValue("2027-12-01");
      fireEvent.blur(input);
      await waitFor(() => expect(attempts).toBe(2));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("C17: a cleared exam date shows nowhere, even though the plan names one, and stays empty on return", async () => {
      let meta: Record<string, Record<string, string>> = { [COURSE]: { exam_date: "2027-01-15" } };
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        read_course_meta: () => structuredClone(meta),
        set_course_meta: (args) => {
          const a = args as { course: string; examDate?: string };
          const entry = { ...(meta[a.course] ?? {}) };
          if (a.examDate === "") delete entry.exam_date;
          else if (a.examDate) entry.exam_date = a.examDate;
          meta = { ...meta, [a.course]: entry };
          return structuredClone(meta);
        },
      });
      await waitForOverview();
      await waitForColumn();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2027-01-15"));
      expect(screen.getByTestId("overview-exam")).toBeInTheDocument();
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      await waitFor(() => expect(meta[COURSE]).toEqual({}));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(input).toHaveValue("");
      expect(screen.getByText("Cell Biology · 7 lectures")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Course map · study plan/ })).toHaveTextContent(
        /^Course map · study plan\s*›$/,
      );
      expect(screen.queryByTestId("overview-exam")).not.toBeInTheDocument();
      // Leave Overview and come back: the field is still empty.
      await router.navigate({
        to: "/course/$course/read/$digest",
        params: { course: COURSE, digest: "2026-10-08-membrane-transport" },
      });
      await waitFor(() => expect(screen.getByTestId("digest-view")).toBeInTheDocument());
      await router.navigate({ to: "/course/$course/overview", params: { course: COURSE } });
      const again = await screen.findByLabelText("Exam date");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(again).toHaveValue("");
    });

    it("C11: clearing a SAVED exam date stays cleared when the plan names one and the refetch is slow", async () => {
      // Real backend: set_course_meta merges exam_date and read_course_meta returns it.
      let meta: Record<string, Record<string, string>> = { [COURSE]: { exam_date: "2027-01-15" } };
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        // Like Tauri, the refetch after the write takes a few ms.
        read_course_meta: () => new Promise((r) => setTimeout(() => r(structuredClone(meta)), 30)),
        set_course_meta: (args) => {
          const a = args as { course: string; examDate?: string };
          const entry = { ...(meta[a.course] ?? {}) };
          if (a.examDate === "") delete entry.exam_date;
          else if (a.examDate) entry.exam_date = a.examDate;
          meta = { ...meta, [a.course]: entry };
          return structuredClone(meta);
        },
      });
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2027-01-15"));
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      await waitFor(() => expect(getMockIpcLog()).toContain("set_course_meta"));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(meta[COURSE]).toEqual({});
      expect(input).toHaveValue("");
    });

    it("C16: clearing right after saving a new date stays cleared when the earlier save's refetch lands mid-write", async () => {
      let meta: Record<string, Record<string, string>> = { [COURSE]: { exam_date: "2027-01-15" } };
      let writes = 0;
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        read_course_meta: () => {
          const snapshot = structuredClone(meta);
          return new Promise((r) => setTimeout(() => r(snapshot), 30));
        },
        set_course_meta: (args) => {
          writes += 1;
          const a = args as { course: string; examDate?: string };
          const entry = { ...(meta[a.course] ?? {}) };
          if (a.examDate === "") delete entry.exam_date;
          else if (a.examDate) entry.exam_date = a.examDate;
          meta = { ...meta, [a.course]: entry };
          const out = structuredClone(meta);
          // The second write (the clear) takes longer than a meta read.
          return writes === 1 ? out : new Promise((r) => setTimeout(() => r(out), 100));
        },
      });
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2027-01-15"));
      fireEvent.change(input, { target: { value: "2027-02-01" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(writes).toBe(1));
      await new Promise((r) => setTimeout(r, 5));
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter" });
      const seen: string[] = [];
      for (let t = 0; t < 30; t += 1) {
        await new Promise((r) => setTimeout(r, 20));
        const v = (input as HTMLInputElement).value;
        if (seen[seen.length - 1] !== v) seen.push(v);
      }
      expect(meta[COURSE]).toEqual({});
      expect(seen).not.toContain("2026-11-04");
      expect(input).toHaveValue("");
    });

    it("C10: Regenerate does not send an exam date the field rejected, and is disabled meanwhile", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2026-11-04"));
      fireEvent.change(input, { target: { value: "0002-11-04" } });
      fireEvent.blur(input);
      expect(input).toHaveAttribute("aria-invalid", "true");
      const regenerate = await screen.findByRole("button", { name: /Regenerate/i });
      expect(regenerate).toBeDisabled();
      await user.click(regenerate);
      expect(getMockIpcLog()).not.toContain("study_plan");
      expect(getMockIpcLog()).not.toContain("set_course_meta");
    });

    it("C10: Regenerate still sends a committable draft the field has not saved yet", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const input = await screen.findByLabelText("Exam date");
      await waitFor(() => expect(input).toHaveValue("2026-11-04"));
      fireEvent.change(input, { target: { value: "2026-12-01" } });
      await user.click(await screen.findByRole("button", { name: /Regenerate/i }));
      await waitFor(() => expect(getMockIpcLog()).toContain("study_plan"));
      const call = getMockIpcCalls().find((c) => c.cmd === "study_plan");
      expect((call?.args as { examDate?: string }).examDate).toBe("2026-12-01");
    });

    it("C12: a ?lectures= value with a bare % does not crash the workspace", async () => {
      await renderAppAtRoute(
        `/course/${COURSE}/overview?lectures=${encodeURIComponent(`${COURSE}/digests/50%-yield.md`)}`,
        workspaceFixtures,
      );
      await waitForOverview();
      expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toBeUndefined();
    });

    it("C12: a malformed percent escape in ?lectures= is ignored and the good entry still ticks", async () => {
      const good = `${COURSE}/digests/2026-10-08-membrane-transport.md`;
      await renderAppAtRoute(
        `/course/${COURSE}/overview?lectures=${encodeURIComponent(`%E0%A4%A,${encodeURIComponent(good)}`)}`,
        workspaceFixtures,
      );
      await waitForOverview();
      await waitFor(() => expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([good]));
    });

    it("C15: a ?lectures= entry that is not a lecture of the class is not ticked or counted", async () => {
      const good = `${COURSE}/digests/2026-10-08-membrane-transport.md`;
      await renderAppAtRoute(
        `/course/${COURSE}/overview?lectures=${encodeURIComponent(`${COURSE}/digests/nope.md`)},${encodeURIComponent(good)}`,
        workspaceFixtures,
      );
      await waitForOverview();
      await waitFor(() => expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([good]));
      expect(screen.getByText("1 lecture selected")).toBeInTheDocument();
    });

    it("C15: a ?lectures= link that names only unknown lectures leaves nothing ticked", async () => {
      await renderAppAtRoute(
        `/course/${COURSE}/overview?lectures=${encodeURIComponent(`${COURSE}/digests/nope.md`)}`,
        workspaceFixtures,
      );
      await waitForOverview();
      await waitForColumn();
      expect(screen.queryByText(/lectures? selected/)).not.toBeInTheDocument();
      expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toBeUndefined();
    });

    it("Drill opens a quiz scoped to the weak topic's lecture", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        study_progress: (args) => {
          if ((args as { action?: string }).action === "overview") {
            return {
              ...fixtureCourseOverview,
              weak: {
                topics: [
                  {
                    label: "Cytoskeleton",
                    digest: "digests/2026-09-11-cytoskeleton.md",
                    heading: "Microtubules",
                    wrong: 3,
                    correct: 6,
                  },
                ],
              },
            };
          }
          return studyProgress(args);
        },
      });
      await waitForOverview();
      expect(await screen.findByText("3 of 9")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Drill Cytoskeleton" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/practice/quiz`));
      // The scope lands in the store and the param leaves the URL (A2).
      await waitFor(() =>
        expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toEqual([
          `${COURSE}/digests/2026-09-11-cytoskeleton.md`,
        ]),
      );
      await waitFor(() => expect(router.state.location.search).toEqual({}));
    });

    it("a weak topic's label opens its lecture at the heading", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        study_progress: (args) =>
          (args as { action?: string }).action === "overview"
            ? {
                ...fixtureCourseOverview,
                weak: {
                  topics: [
                    {
                      label: "Cytoskeleton",
                      digest: "digests/2026-09-11-cytoskeleton.md",
                      heading: "Microtubules",
                    },
                  ],
                },
              }
            : studyProgress(args),
      });
      await waitForOverview();
      await user.click(
        within(await screen.findByLabelText("Weak topics")).getByRole("button", { name: "Cytoskeleton" }),
      );
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/course/${COURSE}/read/2026-09-11-cytoskeleton`),
      );
      expect(router.state.location.search).toEqual({ heading: "Microtubules" });
    });

    it("shows the lecture's title, not the worker's file name, on a Read recommendation", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        study_progress: (args) =>
          (args as { action?: string }).action === "overview"
            ? {
                ...fixtureCourseOverview,
                recommend: {
                  items: [
                    {
                      kind: "unreviewed_digest",
                      label: "Read 2026-10-08-membrane-transport.md",
                      digest: "digests/2026-10-08-membrane-transport.md",
                    },
                  ],
                },
              }
            : studyProgress(args),
      });
      await waitForOverview();
      expect(await screen.findByRole("button", { name: /Read Membrane transport/ })).toBeInTheDocument();
      expect(screen.queryByText(/membrane-transport\.md/)).not.toBeInTheDocument();
    });

    it("renders course.md as Course notes, which a ?heading= from a search hit scrolls to", async () => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
      await renderAppAtRoute(`/course/${COURSE}/overview?heading=Syllabus%20topics`, workspaceFixtures);
      await waitForOverview();
      expect(await screen.findByText(/See the course map for weekly digests/)).toBeVisible();
      expect(screen.getByRole("heading", { name: "Syllabus topics" })).toHaveAttribute("id", "syllabus-topics");
      await waitFor(() => {
        const targets = scrollIntoView.mock.contexts as HTMLElement[];
        expect(targets.some((el) => el.id === "syllabus-topics")).toBe(true);
      });
      scrollIntoView.mockRestore();
    });

    it("shows Course notes expanded on Overview when no heading is given (F79)", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const toggle = await screen.findByRole("button", { name: /Course notes/ });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(await screen.findByText(/See the course map for weekly digests/)).toBeVisible();
      // It sits below the design's sections, and the user can still fold it away.
      const sections = screen.getAllByRole("region").map((el) => el.getAttribute("aria-label"));
      expect(sections.indexOf("Course notes")).toBeGreaterThan(sections.indexOf("Recommended"));
      const user = userEvent.setup();
      await user.click(toggle);
      expect(screen.queryByText(/See the course map for weekly digests/)).not.toBeInTheDocument();
    });

    it("scrolls to Course notes when ?heading= names the section (F79)", async () => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
      await renderAppAtRoute(`/course/${COURSE}/overview?heading=Course%20notes`, workspaceFixtures);
      await waitForOverview();
      expect(await screen.findByText(/See the course map for weekly digests/)).toBeVisible();
      await waitFor(() => {
        const targets = scrollIntoView.mock.contexts as HTMLElement[];
        expect(targets.some((el) => el.getAttribute("aria-label") === "Course notes")).toBe(true);
      });
      scrollIntoView.mockRestore();
    });

    it("a Recommended Read item takes its note from the reading state, not 'never read' (F80)", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        study_progress: (args) =>
          (args as { action?: string }).action === "overview"
            ? {
                ...fixtureCourseOverview,
                recommend: {
                  items: [
                    { kind: "unreviewed_digest", label: "Read a", digest: "digests/2026-10-08-membrane-transport.md" },
                    { kind: "unreviewed_digest", label: "Read b", digest: "digests/2026-10-13-cell-signalling.md" },
                    { kind: "unreviewed_digest", label: "Read c", digest: "digests/2026-10-27-cell-cycle.md" },
                  ],
                },
              }
            : studyProgress(args),
      });
      await waitForOverview();
      const rec = within(await screen.findByLabelText("Recommended"));
      const item = (title: RegExp) => rec.getByRole("button", { name: title });
      // Never opened: New. Part-way: its percent. Read to the end: nothing.
      await waitFor(() => expect(item(/Membrane transport/)).toHaveTextContent("New"));
      expect(item(/Cell signalling/)).toHaveTextContent("40% read");
      expect(item(/Cell cycle/).textContent).toBe("Read Cell cycle");
      expect(screen.queryByText("never read")).not.toBeInTheDocument();
    });

    it("a recommended due-cards item opens the flashcards", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      await user.click(await screen.findByRole("button", { name: /Review 14 due flashcards/i }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/practice/cards`));
    });

    it("a recommended unread lecture opens it in Read", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        study_progress: (args) =>
          (args as { action?: string }).action === "overview"
            ? {
                ...fixtureCourseOverview,
                recommend: {
                  items: [
                    {
                      kind: "unreviewed_digest",
                      label: "Read Apoptosis",
                      digest: "digests/2026-11-03-apoptosis.md",
                    },
                  ],
                },
              }
            : studyProgress(args),
      });
      await waitForOverview();
      await user.click(await screen.findByRole("button", { name: /Read Apoptosis/ }));
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/course/${COURSE}/read/2026-11-03-apoptosis`),
      );
    });

    it("calls study_progress overview once per overview mount", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
        await waitForOverview();
        await vi.advanceTimersByTimeAsync(3500);
        await waitFor(() => {
          const overviewCalls = getMockIpcCalls().filter(
            (c) =>
              c.cmd === "study_progress" && (c.args as { action?: string }).action === "overview",
          );
          expect(overviewCalls.length).toBe(1);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("blocks study plan generate for viewers", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        library_show: () => ({
          present: true,
          name: "Shared",
          created_by: "a@example.com",
          members: [],
          provider: null,
          role: "viewer",
        }),
      });
      await waitForOverview();
      await user.click(await screen.findByRole("button", { name: /Generate|Regenerate/i }));
      expect(getMockIpcLog()).not.toContain("study_plan");
    });

    it("gates study plan generate on auth when signed out", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        check_auth: () => ({
          authenticated: false,
          reason: "Sign in required",
          docs_url: "https://example.com/docs",
        }),
      });
      await waitForOverview();
      await user.click(await screen.findByRole("button", { name: /Regenerate/i }));
      await waitFor(() => {
        expect(screen.getByText(/not authenticated/i)).toBeInTheDocument();
      });
      expect(getMockIpcLog()).not.toContain("study_plan");
    });

    it("calls study_plan with the exam date when authenticated", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      await user.click(await screen.findByRole("button", { name: /Regenerate/i }));
      await waitFor(() => expect(getMockIpcLog()).toContain("study_plan"));
      const call = getMockIpcCalls().find((c) => c.cmd === "study_plan");
      expect((call?.args as { examDate?: string }).examDate).toBe("2026-11-04");
    });

    it("shows Select a model when generating without a model", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        get_settings: () => ({ ...fixtureSettings, model_id: null }),
      });
      await waitForOverview();
      await user.click(await screen.findByRole("button", { name: /Regenerate/i }));
      expect(screen.getByText("Select a model in Settings.")).toBeInTheDocument();
      expect(getMockIpcLog()).not.toContain("study_plan");
    });

    it("logs overview errors without opening the job drawer", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      useJobStore.setState({ lines: [], unread: 0 });
      try {
        await renderAppAtRoute(`/course/${COURSE}/overview`, {
          ...workspaceFixtures,
          study_progress: (args) => {
            if ((args as { action?: string }).action === "overview") {
              throw new Error("overview failed");
            }
            return studyProgress(args);
          },
        });
        await vi.advanceTimersByTimeAsync(3500);
        await waitFor(() => {
          expect(useJobStore.getState().lines.some((l) => l.includes("overview failed"))).toBe(true);
        });
        expect(useUiStore.getState().logOpen).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("omits stat cards when the deck, quiz answers or exam are missing", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, {
        ...workspaceFixtures,
        study_progress: (args) => {
          const action = (args as { action?: string }).action;
          if (action === "overview") {
            return { ...fixtureCourseOverview, due: { due_ids: [], count: 0, deck_count: 0 } };
          }
          if (action === "stats") {
            return {
              quiz: { this_week: { correct: 0, total: 0 }, last_week: { correct: 0, total: 0 } },
              cards: { this_week: { correct: 0, total: 0 }, last_week: { correct: 0, total: 0 } },
            };
          }
          return studyProgress(args);
        },
        read_markdown: (args) => {
          const path = String((args as { relativePath?: string }).relativePath ?? "");
          if (path.endsWith("study/plan.md")) {
            return "";
          }
          return "# Digest\n\nBody.\n";
        },
      });
      await waitFor(() => expect(screen.getByText("Course overview")).toBeInTheDocument());
      await waitFor(() => expect(screen.queryByText("Cards due today")).not.toBeInTheDocument());
      expect(screen.queryByText("Quiz accuracy")).not.toBeInTheDocument();
      expect(screen.queryByText(/^Exam$/)).not.toBeInTheDocument();
    });

    it("keeps the overview in a fixed layout with its own scroller (structure)", async () => {
      await renderAppAtRoute(`/course/${COURSE}/overview`, workspaceFixtures);
      await waitForOverview();
      const pane = screen.getByTestId("overview-pane");
      expect(pane).toHaveClass("flex-1");
      expect(pane).toHaveClass("min-h-0");
      expect(pane).toHaveClass("overflow-y-auto");
      expect(screen.getByRole("navigation", { name: "Lectures" })).toHaveClass("overflow-y-auto");
      // happy-dom has no layout engine; scroll ownership is asserted via structure/classes only.
    });
  });

  describe("read", () => {
    const READ = `/course/${COURSE}/read/2026-10-08-membrane-transport`;
    const DIGEST = `${COURSE}/digests/2026-10-08-membrane-transport.md`;

    it("renders the digest in the reading style with its source and page chips", async () => {
      await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      expect(screen.getByRole("heading", { level: 1, name: "Membrane transport" })).toBeInTheDocument();
      expect(screen.getByText("membrane-transport.pdf")).toBeInTheDocument();
      expect(screen.getByTestId("preview-bar-right")).toHaveTextContent("membrane-transport.pdf · cites 10 pages");
    });

    it("scrolling a digest calls write_reading_state with how far it was read", async () => {
      const sizes = { scrollHeight: 2000, clientHeight: 500 };
      const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
      const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: () => sizes.scrollHeight,
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: () => sizes.clientHeight,
      });
      try {
        await renderAppAtRoute(READ, workspaceFixtures);
        await waitForDigestArticle();
        const writes = () => getMockIpcCalls().filter((c) => c.cmd === "write_reading_state");
        // Opening a lecture counts as opening it (Unread, not New).
        await waitFor(() => expect(writes().length).toBe(1), { timeout: 5000 });
        expect(writes()[0]!.args).toMatchObject({ digest: DIGEST, fraction: 0.25 });
        const pane = screen.getByTestId("digest-view");
        pane.scrollTop = 750;
        fireEvent.scroll(pane);
        // Writes are throttled to one every 2 s per digest.
        await waitFor(() => expect(writes().length).toBe(2), { timeout: 5000 });
        expect(writes()[1]!.args).toMatchObject({ digest: DIGEST, fraction: 0.625 });
      } finally {
        if (heightDescriptor) {
          Object.defineProperty(HTMLElement.prototype, "scrollHeight", heightDescriptor);
        } else {
          Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
        }
        if (clientDescriptor) {
          Object.defineProperty(HTMLElement.prototype, "clientHeight", clientDescriptor);
        } else {
          Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
        }
      }
    });

    it("shows Make card and Ask about this only while text is selected", async () => {
      await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      expect(screen.queryByRole("button", { name: "Make card" })).not.toBeInTheDocument();
      selectFirstParagraph();
      expect(await screen.findByRole("button", { name: "Make card" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Ask about this" })).toBeEnabled();
      window.getSelection()?.removeAllRanges();
      await waitFor(() => expect(screen.queryByRole("button", { name: "Make card" })).not.toBeInTheDocument());
    });

    it("Ask about this opens Ask with the selection as its focus", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      selectFirstParagraph();
      await user.click(await screen.findByRole("button", { name: "Ask about this" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/ask`));
      // Ask takes the focus once: it shows the passage and leaves the store empty.
      expect(await screen.findByTestId("chat-focus")).toHaveTextContent(
        "Phospholipid bilayer with embedded proteins.",
      );
      expect(useSelectionStore.getState().askFocus).toBeNull();
    });

    it("make card saves append_card and opens the flashcards", async () => {
      const user = userEvent.setup();
      const appendedCard = {
        id: "fc-appended-1",
        front: "Appended front",
        back: "Appended back",
        tags: [] as string[],
        source: {
          digest: "digests/2026-10-08-membrane-transport.md",
          heading: "Membrane structure",
          page: null as string | null,
        },
      };
      const { router } = await renderAppAtRoute(READ, {
        ...workspaceFixtures,
        read_study_json: (payload) => {
          const file = String((payload as { file?: string }).file ?? "");
          if (file === "flashcards.json") {
            return { schema_version: 1, course: COURSE, cards: [appendedCard] };
          }
          return { schema_version: 1, course: COURSE, failures: [] };
        },
      });
      await waitForDigestArticle();
      selectFirstParagraph();
      await user.click(await screen.findByRole("button", { name: "Make card" }));
      await user.click(await screen.findByRole("button", { name: /^Save$/i }));
      await waitFor(() => expect(getMockIpcLog()).toContain("append_card"));
      const args = getMockIpcCalls().find((c) => c.cmd === "append_card")?.args as Record<string, unknown>;
      expect(args).toMatchObject({ course: COURSE, digest: "digests/2026-10-08-membrane-transport.md" });
      expect(Object.keys(args).filter((k) => k !== "root" && k !== "course").sort()).toEqual(
        ["back", "digest", "front", "heading", "page"].sort(),
      );
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${COURSE}/practice/cards`), {
        timeout: 8000,
      });
      await waitFor(() => expect(screen.getByText("Appended front")).toBeInTheDocument(), { timeout: 8000 });
    });

    it("validates make card required fields", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      selectFirstParagraph();
      await user.click(await screen.findByRole("button", { name: "Make card" }));
      const front = screen.getByRole("textbox", { name: /Front/i });
      await user.clear(front);
      await user.click(screen.getByRole("button", { name: /^Save$/i }));
      expect(screen.getByText("Front and back are required.")).toBeInTheDocument();
    });

    it("clears the selection toolbar after navigating to another digest", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      selectFirstParagraph();
      await screen.findByRole("button", { name: "Make card" });
      await user.click(screen.getByRole("link", { name: /Mitochondria digest/i }));
      await waitFor(() => expect(router.state.location.pathname).toContain("/read/2026-09-15-mitochondria"));
      expect(screen.queryByRole("button", { name: "Make card" })).not.toBeInTheDocument();
    });

    it("follows in-note digest links", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      await user.click(screen.getByRole("link", { name: /Mitochondria digest/i }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/course/${COURSE}/read/2026-09-15-mitochondria`);
      });
    });

    it("shows concept chips that open the map", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(
        `/course/${COURSE}/read/2026-09-12-membranes`,
        {
          ...workspaceFixtures,
          list_digests: () => [
            ...digestInfos,
            {
              title: "Cell membranes",
              date: "2026-09-12",
              path: `${COURSE}/digests/2026-09-12-membranes.md`,
              unit: "Foundations",
            },
          ],
        },
      );
      await waitForDigestArticle();
      await user.click(await screen.findByRole("button", { name: "Facilitated diffusion" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/course/${COURSE}/map`);
        expect(router.state.location.searchStr).toContain("concept=concept-1");
      });
    });

    it("shows digest load failure copy", async () => {
      await renderAppAtRoute(READ, {
        ...workspaceFixtures,
        read_markdown: () => {
          throw new Error("ENOENT");
        },
      });
      await waitFor(
        () => {
          expect(screen.getByText(/Could not load file:/)).toHaveTextContent("ENOENT");
        },
        { timeout: 8000 },
      );
    });

    it.each([
      ["Glycolysis & yield", "Glycolysis & yield"],
      ["The *lac* operon", "The *lac* operon"],
      ['Cell\'s "powerhouse"', 'Cell\'s "powerhouse"'],
    ])("prints the title once when the digest's own H1 is %s", async (title, h1) => {
      await renderAppAtRoute(READ, {
        ...workspaceFixtures,
        list_digests: () =>
          digestInfos.map((d) => (d.path.endsWith("membrane-transport.md") ? { ...d, title } : d)),
        read_markdown: (args) =>
          String((args as { relativePath?: string }).relativePath).includes("/digests/")
            ? `# ${h1}\n\n<!-- arbor-pages:3-4 -->\n\n## Membrane structure\n\nPhospholipid text.\n`
            : "",
      });
      await waitForDigestArticle();
      expect(screen.getAllByRole("heading", { level: 1, name: title })).toHaveLength(1);
      expect(screen.getByRole("article").querySelector("h1")).toBeNull();
    });

    it("shows the source file and how many of its pages the digest cites, not the file's length (F82)", async () => {
      await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      const bar = await screen.findByTestId("preview-bar-right");
      expect(bar).toHaveTextContent("membrane-transport.pdf");
      expect(bar).toHaveTextContent("membrane-transport.pdf · cites 10 pages");
    });

    it("scrolls the digest to its heading search param", async () => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
      await renderAppAtRoute(`${READ}?heading=Membrane%20structure`, workspaceFixtures);
      await waitForDigestArticle();
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      scrollIntoView.mockRestore();
    });

    it("leaves room under the reading pane while the tray is open", async () => {
      useLectureSelectionStore.getState().setScope(SCOPE_KEY, [DIGEST]);
      await renderAppAtRoute(READ, workspaceFixtures);
      await waitForDigestArticle();
      expect(screen.getByTestId("workspace-main")).toHaveClass("pb-20");
      // The column keeps its full height (the tray floats over it); its list scrolls clear of the tray.
      const column = screen.getByRole("navigation", { name: "Lectures" });
      expect(column.parentElement).not.toHaveClass("pb-20");
      expect(column).toHaveClass("pb-20");
    });
  });

  it("sidebar course navigation lands on overview not a digest", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute(`/course/${COURSE}/practice/cards`, workspaceFixtures);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Organic Chemistry/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Organic Chemistry/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/overview");
    });
  });
});
