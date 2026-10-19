import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import {
  FIXTURE_MARKER,
  fixtureCourseOverview,
  fixtureSettings,
} from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { useJobStore } from "~/stores/job-store";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

async function waitForOverview() {
  await waitFor(
    () => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
      expect(screen.getByText("Cards due today")).toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

async function waitForDigestArticle() {
  await waitFor(() => expect(screen.getByTestId("digest-view")).toBeInTheDocument(), {
    timeout: 5000,
  });
  await waitFor(
    () => {
      const article = screen.getByRole("article");
      expect(article.textContent).toContain(FIXTURE_MARKER);
    },
    { timeout: 5000 },
  );
}

describe("notes PR7", { timeout: 15000 }, () => {
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
      notesIndexOpen: true,
      lastCourse: null,
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
    clearMockIpcLog();
  });

  afterEach(() => {
    cleanup();
    resetMockHandlerTimers();
    clearMocks();
    vi.restoreAllMocks();
  });

  it("renders overview stat tiles and course map flags", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText(/Quiz accuracy/i)).toBeInTheDocument();
    expect(screen.getByText(/78%/)).toBeInTheDocument();
    expect(screen.getByText("weak")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText(/Exam focus:/)).toBeInTheDocument();
  });

  it("navigates review due cards to flashcards", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Review 14 due cards/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/flashcards");
    });
  });

  it("navigates explain weakest topic with legacy prompt", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Explain weakest topic/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/chat");
      const search = router.state.location.search as { mode?: string; prompt?: string };
      expect(search.mode).toBe("explain");
      expect(search.prompt).toBe(
        'Explain the weakest topic "Cytoskeleton". Stay inside this course and cite sources.',
      );
    });
  });

  it("opens a recommended digest with heading search param", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await waitFor(() => expect(screen.getByText("Recommended")).toBeInTheDocument());
    const chips = screen.getAllByRole("button", { name: "Cytoskeleton" });
    await user.click(chips[chips.length - 1]!);
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
      expect(router.state.location.searchStr).toContain("heading=Microtubules");
    });
  });

  it("calls study_progress overview once per overview mount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderAppAtRoute("/course/cell-biology/notes");
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
    await renderAppAtRoute("/course/cell-biology/notes", {
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
    await user.click(screen.getByRole("button", { name: /Generate|Regenerate/i }));
    expect(getMockIpcLog()).not.toContain("study_plan");
  });

  it("gates study plan generate on auth when signed out", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes", {
      check_auth: () => ({
        authenticated: false,
        reason: "Sign in required",
        docs_url: "https://example.com/docs",
      }),
    });
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Regenerate/i }));
    await waitFor(() => {
      expect(screen.getByText(/not authenticated/i)).toBeInTheDocument();
    });
    expect(getMockIpcLog()).not.toContain("study_plan");
  });

  it("calls study_plan with exam date when authenticated", async () => {
    const user = userEvent.setup();
    clearMockIpcLog();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Regenerate/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("study_plan"));
    const call = getMockIpcCalls().find((c) => c.cmd === "study_plan");
    expect((call?.args as { examDate?: string }).examDate).toBe("2026-11-04");
  });

  it("lists overview first then digests in fixture order", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await waitFor(() => expect(getMockIpcLog()).toContain("list_digests"));
    const index = await screen.findByRole("navigation", { name: /Course index/i });
    await waitFor(() => {
      expect(within(index).getByText("Stem cells")).toBeInTheDocument();
    });
    const overview = within(index).getByRole("button", { name: /Overview/i });
    const firstDigest = within(index).getByRole("button", { name: /Stem cells/i });
    const buttons = within(index).getAllByRole("button");
    expect(buttons.indexOf(overview)).toBeLessThan(buttons.indexOf(firstDigest));
  });

  it("marks active index row with aria-current", async () => {
    await renderAppAtRoute("/course/cell-biology/notes/2026-09-12-membranes");
    await waitForDigestArticle();
    const index = screen.getByRole("navigation", { name: /Course index/i });
    const active = within(index).getAllByRole("button", { current: "page" });
    expect(active.some((el) => el.textContent?.includes("Cell membranes"))).toBe(true);
  });

  it("persists hide/show index via notesIndexOpen", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Hide index/i }));
    expect(useUiStore.getState().notesIndexOpen).toBe(false);
    await user.click(screen.getByRole("button", { name: /Show index/i }));
    expect(useUiStore.getState().notesIndexOpen).toBe(true);
  });

  it("renders digest markdown, page chip, and concept chips", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes/2026-09-12-membranes");
    await waitForDigestArticle();
    expect(screen.getByText(/Pages 12–18/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Facilitated diffusion" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/graph");
      expect(router.state.location.searchStr).toContain("concept=concept-1");
    });
  });

  it("follows in-note digest links", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes/2026-09-12-membranes");
    await waitForDigestArticle();
    await user.click(screen.getByRole("link", { name: /Mitochondria digest/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-15-mitochondria");
    });
  });

  it("make card saves append_card and navigates to flashcards", async () => {
    const user = userEvent.setup();
    clearMockIpcLog();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes/2026-09-12-membranes");
    await waitForDigestArticle();
    const article = screen.getByRole("article");
    const paragraph = article.querySelector("p");
    expect(paragraph).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Make card/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: /Make card/i }));
    const save = await screen.findByRole("button", { name: /^Save$/i });
    await user.click(save);
    await waitFor(() => expect(getMockIpcLog()).toContain("append_card"));
    const appendCall = getMockIpcCalls().find((c) => c.cmd === "append_card");
    const args = appendCall?.args as Record<string, unknown>;
    expect(args).toMatchObject({
      course: "cell-biology",
      digest: "digests/2026-09-12-membranes.md",
    });
    expect(Object.keys(args).filter((k) => k !== "root" && k !== "course").sort()).toEqual(
      ["back", "digest", "front", "heading", "page"].sort(),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/flashcards");
    });
  });

  it("disables make card after navigating to another digest", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes/2026-09-12-membranes");
    await waitForDigestArticle();
    const article = screen.getByRole("article");
    const paragraph = article.querySelector("p");
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Make card/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole("link", { name: /Mitochondria digest/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-15-mitochondria");
    });
    expect(screen.getByRole("button", { name: /Make card/i })).toBeDisabled();
  });

  it("validates make card required fields", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes/2026-09-12-membranes");
    await waitForDigestArticle();
    const article = screen.getByRole("article");
    const paragraph = article.querySelector("p");
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Make card/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: /Make card/i }));
    const front = screen.getByRole("textbox", { name: /Front/i });
    await user.clear(front);
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(screen.getByText("Front and back are required.")).toBeInTheDocument();
  });

  it("sidebar course navigation lands on overview not a digest", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/flashcards");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Organic Chemistry/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Organic Chemistry/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/notes");
    });
  });

  it("opens weak topic digest with digests path ref and heading", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    const cytoskeletonButtons = screen.getAllByRole("button", { name: "Cytoskeleton" });
    await user.click(cytoskeletonButtons[cytoskeletonButtons.length - 1]!);
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
      expect(router.state.location.searchStr).toContain("heading=Microtubules");
    });
  });

  it("shows digest load failure copy", async () => {
    await renderAppAtRoute("/course/cell-biology/notes/2026-09-12-membranes", {
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

  it("logs overview errors without opening the job drawer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useJobStore.setState({ lines: [], unread: 0 });
    try {
      await renderAppAtRoute("/course/cell-biology/notes", {
        study_progress: (args) => {
          if ((args as { action?: string }).action === "overview") {
            throw new Error("overview failed");
          }
          return {};
        },
      });
      await vi.advanceTimersByTimeAsync(3500);
      await waitFor(() => {
        expect(useJobStore.getState().lines.some((l) => l.includes("overview failed"))).toBe(
          true,
        );
      });
      expect(useUiStore.getState().logOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("omits stat tiles when deck, quiz answers, or exam are missing", async () => {
    await renderAppAtRoute("/course/cell-biology/notes", {
      study_progress: (args) => {
        if ((args as { action?: string }).action === "overview") {
          return { ...fixtureCourseOverview, due: { due_ids: [], count: 0, deck_count: 0 } };
        }
        return {};
      },
      read_quiz_progress: () => ({}),
      read_markdown: (args) => {
        const path = String((args as { relativePath?: string }).relativePath ?? "");
        if (path.endsWith("study/plan.md")) {
          return "Exam date: 2020-01-01\n";
        }
        if (path.endsWith("/course.md")) {
          return "# Cell Biology\n\nIntro.\n";
        }
        if (path.includes("/digests/")) {
          return "# Digest\n\nBody.\n";
        }
        throw new Error(path);
      },
    });
    await waitFor(() => {
      expect(screen.getByText("Course overview")).toBeInTheDocument();
    });
    expect(screen.queryByText("Cards due today")).not.toBeInTheDocument();
    expect(screen.queryByText(/Quiz accuracy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Exam$/)).not.toBeInTheDocument();
  });

  it("shows Select a model when generating without a model", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes", {
      get_settings: () => ({ ...fixtureSettings, model_id: null }),
    });
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(screen.getByText("Select a model in Settings.")).toBeInTheDocument();
    expect(getMockIpcLog()).not.toContain("study_plan");
  });

  it("scrolls digest view to heading search param", async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    await renderAppAtRoute(
      "/course/cell-biology/notes/2026-09-12-membranes?heading=Membrane%20structure",
    );
    await waitForDigestArticle();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    scrollIntoView.mockRestore();
  });

  it("scrolls overview to heading search param", async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    await renderAppAtRoute("/course/cell-biology/notes?heading=Syllabus%20topics");
    await waitForOverview();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    scrollIntoView.mockRestore();
  });

  it("opens narrow index sheet from Show index without changing notesIndexOpen", async () => {
    const OriginalRO = globalThis.ResizeObserver;
    class MockResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        Object.defineProperty(el, "clientWidth", {
          configurable: true,
          value: 500,
        });
        this.cb([{ target: el } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    }
    globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;

    const user = userEvent.setup();
    useUiStore.setState({ notesIndexOpen: true });
    try {
      await renderAppAtRoute("/course/cell-biology/notes");
      await waitForOverview();
      await user.click(screen.getByRole("button", { name: /Show index/i }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      expect(useUiStore.getState().notesIndexOpen).toBe(true);
    } finally {
      globalThis.ResizeObserver = OriginalRO;
    }
  });

  it("opens mobile sidebar sheet without changing persisted sidebarOpen", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(700);
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true });
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Toggle Sidebar/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });

  it("keeps the notes index in a fixed layout with a dedicated reading-pane scroller (structure)", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    const layout = screen.getByTestId("notes-layout");
    expect(layout).toHaveClass("h-full");
    expect(layout).toHaveClass("overflow-hidden");
    const pane = screen.getByTestId("notes-reading-pane");
    expect(pane).toHaveClass("flex-1");
    expect(pane).toHaveClass("min-h-0");
    expect(pane).toHaveClass("overflow-y-auto");
    const index = screen.getByRole("navigation", { name: /Course index/i });
    expect(index).toHaveClass("overflow-y-auto");
    // happy-dom has no layout engine; scroll ownership is asserted via structure/classes only.
  });

  it("does not duplicate overview headings from embedded markdown", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    expect(screen.getByRole("heading", { level: 3, name: "Study plan" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Study plan" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1, name: "Cell Biology" })).toHaveLength(1);
    expect(screen.queryByText(/^Exam date:\s*2026-11-04/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Syllabus topics/i)).toBeInTheDocument();
  });
});
