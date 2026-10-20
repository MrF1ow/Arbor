import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { FIXTURE_ROOT_FALL, fixtureSettings } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

const searchButtonName = /Search \(Ctrl\+K\)/i;

async function waitForOverview() {
  await waitFor(() => {
    expect(screen.getByText("Course overview")).toBeInTheDocument();
  });
}

function searchDialog() {
  return screen.getByRole("dialog");
}

async function openSearchPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");
  await waitFor(() => {
    expect(within(searchDialog()).getByLabelText("Search digests")).toBeInTheDocument();
  });
}

describe("search palette", { timeout: 15000 }, () => {
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
      searchSemantic: false,
      lastCourse: null,
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens with Mod+K and closes with Escape", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await openSearchPalette(user);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Search digests")).not.toBeInTheDocument();
    });
  });

  it("opens with Mod+K while an input is focused", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Add class/i }));
    const input = await screen.findByLabelText(/Class name/i);
    await user.click(input);
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.getByLabelText("Search digests")).toBeInTheDocument();
    });
  });

  it("opens from the header Search button", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: searchButtonName }));
    await waitFor(() => {
      expect(screen.getByLabelText("Search digests")).toBeInTheDocument();
    });
  });

  it("debounces search_knowledge to one call after 250ms", async () => {
    clearMockIpcLog();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openSearchPalette(timedUser);
    await timedUser.type(within(searchDialog()).getByLabelText("Search digests"), "mem");
    await vi.advanceTimersByTimeAsync(100);
    expect(getMockIpcCalls().filter((c) => c.cmd === "search_knowledge")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => {
      const calls = getMockIpcCalls().filter((c) => c.cmd === "search_knowledge");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toMatchObject({
        root: FIXTURE_ROOT_FALL,
        query: "mem",
        limit: 20,
      });
    });
  });

  it("uses search_semantic when semantic is enabled and persists the preference", async () => {
    clearMockIpcLog();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openSearchPalette(timedUser);
    await timedUser.click(screen.getByRole("switch", { name: /Semantic search/i }));
    expect(useUiStore.getState().searchSemantic).toBe(true);
    await timedUser.type(within(searchDialog()).getByLabelText("Search digests"), "cell");
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "search_semantic")).toBe(true);
    });
    await timedUser.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Search digests")).not.toBeInTheDocument();
    });
    await openSearchPalette(timedUser);
    expect(useUiStore.getState().searchSemantic).toBe(true);
  });

  it("re-runs semantic search on toggle without retyping", async () => {
    clearMockIpcLog();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openSearchPalette(timedUser);
    await timedUser.type(within(searchDialog()).getByLabelText("Search digests"), "membrane");
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => {
      expect(getMockIpcCalls().filter((c) => c.cmd === "search_knowledge").length).toBeGreaterThan(
        0,
      );
    });
    clearMockIpcLog();
    await timedUser.click(screen.getByRole("switch", { name: /Semantic search/i }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "search_semantic")).toBe(true);
    });
  });

  it("shows empty-query copy on the notes route", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await openSearchPalette(user);
    expect(within(searchDialog()).getByText("Type to search digests")).toBeInTheDocument();
  });

  it("shows no-results copy for zzz", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openSearchPalette(timedUser);
    await timedUser.type(within(searchDialog()).getByLabelText("Search digests"), "zzz");
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => {
      expect(within(searchDialog()).getByText("No results")).toBeInTheDocument();
    });
  });

  it("shows no-root copy on welcome without an active library", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/welcome", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    await openSearchPalette(user);
    expect(within(searchDialog()).getByText("Choose a Knowledge folder first.")).toBeInTheDocument();
  });

  it("renders row meta, snippets, and course grouping", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = searchDialog();
    await user.type(within(dialog).getByLabelText("Search digests"), "2026");
    await waitFor(
      () => {
        expect(within(dialog).getByText("Cell membranes")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(
      within(dialog).getByText(
        "Cell Biology · cell-biology/digests/2026-09-12-membranes.md · p.3-5",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Phospholipid bilayer/)).toBeInTheDocument();
    expect(within(dialog).getByText("Organic Chemistry II")).toBeInTheDocument();
  });

  it("shows a kind badge for non-digest hits", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = searchDialog();
    await user.type(within(dialog).getByLabelText("Search digests"), "plan");
    await waitFor(() => {
      expect(within(dialog).getByText("Study plan")).toBeInTheDocument();
    });
    expect(within(dialog).getByText("plan", { exact: true })).toBeInTheDocument();
  });

  it("opens digest hits on Enter and course.md on click", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = searchDialog();
    await user.type(within(dialog).getByLabelText("Search digests"), "membrane");
    await waitFor(
      () => {
        expect(within(dialog).getByText("Cell membranes")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Search digests")).not.toBeInTheDocument();
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
    });
    await openSearchPalette(user);
    const dialogAgain = searchDialog();
    await user.type(within(dialogAgain).getByLabelText("Search digests"), "syllabus");
    await waitFor(() => {
      expect(
        within(dialogAgain).getByText("Cell Biology · cell-biology/course.md"),
      ).toBeInTheDocument();
    });
    await user.click(within(dialogAgain).getByText("Cell Biology · cell-biology/course.md"));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/notes");
    });
  });

  it("clears query when the active root changes", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = searchDialog();
    await user.type(within(dialog).getByLabelText("Search digests"), "membrane");
    await waitFor(
      () => {
        expect(within(dialog).getByText("Cell membranes")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Collab Notes/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Collab Notes/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/collab-notes/notes");
    });
    await openSearchPalette(user);
    await waitFor(() => {
      expect(within(searchDialog()).getByLabelText("Search digests")).toHaveValue("");
      expect(within(searchDialog()).getByText("Type to search digests")).toBeInTheDocument();
    });
  });
});
