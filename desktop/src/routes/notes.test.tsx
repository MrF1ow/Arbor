import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { FIXTURE_MARKER } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcCalls, getMockIpcLog } from "~/test/mock-handlers";
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
      expect(search.prompt).toContain("Cytoskeleton");
      expect(search.prompt).toContain("Stay inside this course and cite sources.");
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
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await waitFor(() => {
      const overviewCalls = getMockIpcCalls().filter(
        (c) => c.cmd === "study_progress" && (c.args as { action?: string }).action === "overview",
      );
      expect(overviewCalls.length).toBe(1);
    });
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
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/flashcards");
      expect(router.state.location.searchStr).toContain("card=fc-appended-1");
    });
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
});
