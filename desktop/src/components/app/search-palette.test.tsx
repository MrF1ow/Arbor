import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { qk } from "~/lib/queries/keys";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";
import type { SearchHit } from "~/domain/types";

const searchButtonName = /Search notes, concepts, and cards in every class/i;

const hit = (
  course: string,
  kind: string,
  title: string,
  snippet: string,
  path = `${course}/digests/${title.toLowerCase().replace(/\W+/g, "-")}.md`,
  page_range: string | null = null,
  item_id?: string,
): SearchHit & { item_id?: string } => ({ course, kind, title, snippet, path, page_range, source_path: null, ...(item_id ? { item_id } : {}) });

/** What each library's `search_knowledge` holds: the palette asks every library. */
const HITS_BY_ROOT: Record<string, (SearchHit & { item_id?: string })[]> = {
  [FIXTURE_ROOT_FALL]: [
    hit("cell-biology", "digest", "Cell membranes", "Phospholipid bilayer and membrane proteins.", "cell-biology/digests/2026-09-12-membranes.md", "3-5"),
    hit("cell-biology", "digest", "Membrane transport", "Facilitated diffusion uses channel or carrier proteins.", "cell-biology/digests/2026-09-19-transport.md"),
    hit("organic-chemistry-ii", "digest", "Alkanes", "Conformations and naming of alkanes.", "organic-chemistry-ii/digests/2026-10-01-alkanes.md"),
    hit("cell-biology", "card", "Does facilitated diffusion require ATP?", "No. It moves solutes down their gradient.", "cell-biology/study/flashcards.json#fc_1", null, "fc_1"),
    hit("cell-biology", "question", "Which protein moves solutes down a gradient?", "A carrier protein.", "cell-biology/study/quiz.json#q_7", null, "q_7"),
    hit("cell-biology", "concept", "Facilitated diffusion", "Linked to carrier proteins, passive transport", "cell-biology/study/concepts.json#c_1", null, "c_1"),
    hit("cell-biology", "course_md", "Cell Biology", "Course overview and syllabus topics.", "cell-biology/course.md"),
    hit("cell-biology", "plan", "Study plan", "Weekly review schedule before the exam.", "cell-biology/study/plan.md"),
    hit("cell-biology", "other", "Misc notes", "Unlisted path opens overview with toast.", "cell-biology/misc/notes.txt"),
  ],
  [FIXTURE_ROOT_SHARED]: [
    hit("collab-notes", "digest", "Shared agenda", "Passive diffusion across the group's notes.", "collab-notes/digests/2026-10-02-agenda.md"),
  ],
};

function searchByRoot(args: unknown): (SearchHit & { item_id?: string })[] {
  const { root, query } = args as { root: string; query: string };
  const needle = query.trim().toLowerCase();
  if (!needle || needle === "zzz") {
    return [];
  }
  return (HITS_BY_ROOT[root] ?? []).filter((candidate) =>
    [candidate.title, candidate.snippet, candidate.path, candidate.course].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

const searchFixtures = { search_knowledge: searchByRoot };

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
  // The palette is a lazy chunk: the first open in this file waits on a cold
  // import, which can take well over 5s when the whole suite runs in parallel.
  // Ctrl+K toggles, so pressing again would close it; wait instead.
  await waitFor(
    () => {
      expect(within(searchDialog()).getByLabelText("Search digests")).toBeInTheDocument();
    },
    { timeout: 12_000 },
  );
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
      lastCourse: null,
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("anchors the palette below the header with a scrollable results list", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = searchDialog();
    expect(dialog.className).toContain("top-palette-top");
    expect(dialog.className).toContain("translate-y-0");
    expect(dialog.className).not.toContain("top-1/2");
    expect(dialog.querySelector("[data-slot=command-list]")?.className).toContain(
      "max-h-80",
    );
  });

  it("opens with Mod+K and closes with Escape", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Search digests")).not.toBeInTheDocument();
    });
  });

  it("opens with Mod+K while an input is focused", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: /Add class/i }));
    const input = await screen.findByLabelText(/Class name/i);
    await user.click(input);
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.getByLabelText("Search digests")).toBeInTheDocument();
    });
  });

  it("opens from the top bar search field", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await user.click(screen.getByRole("button", { name: searchButtonName }));
    await waitFor(() => {
      expect(screen.getByLabelText("Search digests")).toBeInTheDocument();
    });
  });

  it("debounces search_knowledge to one call per library after 250ms", async () => {
    clearMockIpcLog();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
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
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.args)).toEqual(
        expect.arrayContaining([
          { root: FIXTURE_ROOT_FALL, query: "mem", limit: 20 },
          { root: FIXTURE_ROOT_SHARED, query: "mem", limit: 20 },
        ]),
      );
    });
  });

  it("has no Semantic chip, no Tab hint, and Tab does not search another way", async () => {
    clearMockIpcLog();
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = searchDialog();
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/semantic/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText("move · Enter opens")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Search digests"), "membrane");
    await waitFor(() => {
      expect(within(dialog).getByText("Cell membranes")).toBeInTheDocument();
    });
    await user.keyboard("{Tab}");
    expect(getMockIpcCalls().every((c) => c.cmd !== "search_semantic")).toBe(true);
    expect(getMockIpcCalls().some((c) => c.cmd === "search_knowledge")).toBe(true);
  });

  it("ignores a searchSemantic left in old storage", async () => {
    clearMockIpcLog();
    localStorage.setItem(
      "arbor.ui",
      JSON.stringify({
        state: { searchSemantic: true },
        version: 0,
      }),
    );
    useUiStore.persist.rehydrate();
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    expect(within(searchDialog()).queryByRole("switch")).not.toBeInTheDocument();
    await user.type(within(searchDialog()).getByLabelText("Search digests"), "membrane");
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "search_knowledge")).toBe(true);
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "search_semantic")).toBe(false);
  });

  it("ignores stale search responses when a newer query completes first", async () => {
    let slowResolve: ((value: unknown) => void) | undefined;
    const slowPromise = new Promise((resolve) => {
      slowResolve = resolve;
    });
    await renderAppAtRoute("/course/cell-biology/overview", {
      search_knowledge: (args) => {
        const { query, root } = args as { query: string; root: string };
        if (root !== FIXTURE_ROOT_FALL) {
          return [];
        }
        if (query === "slow") {
          return slowPromise;
        }
        if (query === "fast") {
          return [
            {
              course: "cell-biology",
              path: "cell-biology/digests/2026-09-12-membranes.md",
              kind: "digest",
              title: "Fast result",
              snippet: "Fast wins",
              page_range: null,
              source_path: null,
            },
          ];
        }
        return [];
      },
    });
    await waitForOverview();
    const user = userEvent.setup();
    await openSearchPalette(user);
    const input = within(searchDialog()).getByLabelText("Search digests");
    await user.type(input, "slow");
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "search_knowledge")).toBe(true);
    });
    await user.clear(input);
    await user.type(input, "fast");
    await waitFor(() => {
      expect(within(searchDialog()).getByText("Fast result")).toBeInTheDocument();
    });
    slowResolve?.([
      {
        course: "cell-biology",
        path: "cell-biology/course.md",
        kind: "course_md",
        title: "Stale result",
        snippet: "Should not appear",
        page_range: null,
        source_path: null,
      },
    ]);
    await waitFor(() => {
      expect(within(searchDialog()).queryByText("Stale result")).not.toBeInTheDocument();
      expect(within(searchDialog()).getByText("Fast result")).toBeInTheDocument();
    });
  });

  it("shows empty-query copy on the notes route", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    expect(within(searchDialog()).getByText("Type to search every class")).toBeInTheDocument();
  });

  it("shows no-results copy for zzz", async () => {
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
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

  it("says no note contains a multi-word phrase and points to Ask", async () => {
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openSearchPalette(timedUser);
    await timedUser.type(within(searchDialog()).getByLabelText("Search digests"), '  kidney   "protein" kids ');
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => {
      expect(within(searchDialog()).getByText('No notes contain "kidney protein kids"')).toBeInTheDocument();
    });
    expect(within(searchDialog()).getByText("Ask your class a question instead.")).toBeInTheDocument();
    expect(within(searchDialog()).queryByText("No results")).not.toBeInTheDocument();
  });

  it("keeps No results for a one-word query with no hits", async () => {
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openSearchPalette(timedUser);
    await timedUser.type(within(searchDialog()).getByLabelText("Search digests"), "zzz");
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => {
      expect(within(searchDialog()).getByText("No results")).toBeInTheDocument();
    });
    expect(within(searchDialog()).queryByText("Ask your class a question instead.")).not.toBeInTheDocument();
  });

  it("renders a multi-word hit with its class name and the result count", async () => {
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openSearchPalette(timedUser);
    await timedUser.type(within(searchDialog()).getByLabelText("Search digests"), "facilitated diffusion");
    await vi.advanceTimersByTimeAsync(250);
    const dialog = within(searchDialog());
    await waitFor(() => {
      expect(dialog.getByText("Does facilitated diffusion require ATP?")).toBeInTheDocument();
    });
    expect(dialog.getAllByText(/Cell Biology/).length).toBeGreaterThan(0);
    expect(dialog.queryByText(/No notes contain/)).not.toBeInTheDocument();
    expect(dialog.getByText(/results? in \d+ class/)).toBeInTheDocument();
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

  async function searchFor(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(within(searchDialog()).getByLabelText("Search digests"), text);
  }

  it("groups hits as Digests, Cards and Concepts across every class, with a count footer", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = within(searchDialog());
    await searchFor(user, "diffusion");
    await waitFor(
      () => {
        expect(dialog.getByText("4 results in 2 classes")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const headings = Array.from(searchDialog().querySelectorAll("[cmdk-group-heading]")).map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["Digests", "Cards", "Concepts"]);

    const rows = dialog.getAllByRole("option").map((row) => row.textContent);
    expect(rows).toEqual([
      "Membrane transportCell BiologyFacilitated diffusion uses channel or carrier proteins.",
      "Shared agendaCollab NotesPassive diffusion across the group's notes.",
      "Does facilitated diffusion require ATP?Cell Biology · cardNo. It moves solutes down their gradient.",
      "Facilitated diffusionCell Biology · conceptLinked to carrier proteins, passive transport",
    ]);
    expect(dialog.getByText("move · Enter opens")).toBeInTheDocument();
  });

  it("counts a single result in a single class in the singular", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "alkanes");
    await waitFor(() => {
      expect(within(searchDialog()).getByText("1 result in 1 class")).toBeInTheDocument();
    });
  });

  it("puts the class overview, plan and other hits in an Overview group, last, with their kind in the meta", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = within(searchDialog());
    await searchFor(user, "cell");
    await waitFor(() => {
      expect(dialog.getByText("Study plan")).toBeInTheDocument();
    });
    expect(dialog.getByText("Cell Biology · plan")).toBeInTheDocument();
    expect(dialog.getByText("Cell Biology · overview")).toBeInTheDocument();
    const headings = Array.from(searchDialog().querySelectorAll("[cmdk-group-heading]")).map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["Digests", "Cards", "Concepts", "Overview"]);
  });

  it("renders hits on the same path with distinct selection", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    const dialog = searchDialog();
    await user.type(within(dialog).getByLabelText("Search digests"), "membrane");
    await waitFor(() => {
      expect(within(dialog).getByText("Cell membranes")).toBeInTheDocument();
      expect(within(dialog).getByText("Membrane transport")).toBeInTheDocument();
    });
    const selected = within(dialog).getAllByRole("option", { selected: true });
    expect(selected).toHaveLength(1);
  });

  it("closes the palette with Mod+K from the search input", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    const input = within(searchDialog()).getByLabelText("Search digests");
    await user.click(input);
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Search digests")).not.toBeInTheDocument();
    });
  });

  it("focuses and selects existing text when reopened", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    const input = within(searchDialog()).getByLabelText("Search digests");
    await user.type(input, "membrane");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Search digests")).not.toBeInTheDocument();
    });
    await openSearchPalette(user);
    const reopened = within(searchDialog()).getByLabelText("Search digests") as HTMLInputElement;
    expect(reopened.value).toBe("membrane");
    expect(reopened.selectionStart).toBe(0);
    expect(reopened.selectionEnd).toBe("membrane".length);
  });

  it("opens digest hits on Enter and the class overview on click, through classPath", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "membrane");
    await waitFor(
      () => {
        expect(within(searchDialog()).getByText("Cell membranes")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Search digests")).not.toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/course/cell-biology/read/2026-09-12-membranes");
    });
    await openSearchPalette(user);
    const input = within(searchDialog()).getByLabelText("Search digests");
    await user.clear(input);
    await user.type(input, "syllabus");
    await waitFor(() => {
      expect(within(searchDialog()).getByText("Course overview and syllabus topics.")).toBeInTheDocument();
    });
    await user.click(within(searchDialog()).getByText("Course overview and syllabus topics."));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/overview");
    });
  });

  it("opens card hits on Practice › Cards and concept hits on the Map", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "diffusion");
    await user.click(await within(searchDialog()).findByRole("option", { name: /Does facilitated diffusion require ATP/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/practice/cards");
    });
    await openSearchPalette(user);
    await user.click(await within(searchDialog()).findByRole("option", { name: /Facilitated diffusion\s*Cell Biology · concept/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/map");
    });
  });

  async function openHitAndRead(query: string, name: RegExp) {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    // The Cards and Map views clear their param once they have focused the item, so record every location.
    const searches: Record<string, string>[] = [];
    router.history.subscribe(({ location }) => {
      searches.push(Object.fromEntries(new URLSearchParams(location.search)));
    });
    await openSearchPalette(user);
    await searchFor(user, query);
    await user.click(await within(searchDialog()).findByRole("option", { name }, { timeout: 10_000 }));
    return { router, searches };
  }

  it("opens the card a card hit names", async () => {
    const { router, searches } = await openHitAndRead("diffusion", /Does facilitated diffusion require ATP/);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/practice/cards");
    });
    expect(searches).toContainEqual(expect.objectContaining({ card: "fc_1" }));
  });

  it("opens the concept a concept hit names on the Map", async () => {
    const { router, searches } = await openHitAndRead("diffusion", /Facilitated diffusion\s*Cell Biology · concept/);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/map");
    });
    expect(searches).toContainEqual(expect.objectContaining({ concept: "c_1" }));
  });

  it("opens the quiz for a question hit (the quiz route takes no question param)", async () => {
    const { router } = await openHitAndRead("gradient", /Which protein moves solutes/);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/practice/quiz");
    });
  });

  it("opens a hit in another library by switching to it first (Q10)", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "diffusion");
    clearMockIpcLog();
    await user.click(await within(searchDialog()).findByRole("option", { name: /Shared agenda/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/collab-notes/read/2026-10-02-agenda");
    });
    const saved = getMockIpcCalls().filter((c) => c.cmd === "save_settings");
    expect(saved).toHaveLength(1);
    expect((saved[0]!.args as { settings: { active_root: string } }).settings.active_root).toBe(
      FIXTURE_ROOT_SHARED,
    );
  });

  it("opens plan hits on the overview", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "plan");
    await user.click(await within(searchDialog()).findByRole("option", { name: /Study plan/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/overview");
      expect(router.state.location.search.heading).toBe("Study plan");
    });
  });

  it("shows a toast for unknown paths", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "misc");
    await user.click(await within(searchDialog()).findByRole("option", { name: /Misc notes/i }));
    await waitFor(
      () => {
        expect(screen.getByText("Opened Cell Biology")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("keeps the other libraries' hits when one library's search fails", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", {
      ...searchFixtures,
      search_knowledge: (args) => {
        if ((args as { root: string }).root === FIXTURE_ROOT_FALL) {
          throw new Error("Search backend unavailable");
        }
        return searchByRoot(args);
      },
    });
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "diffusion");
    await waitFor(() => {
      expect(within(searchDialog()).getByText("Shared agenda")).toBeInTheDocument();
    });
    expect(within(searchDialog()).queryByText("Search backend unavailable")).not.toBeInTheDocument();
  });

  it("names the library whose search failed while other libraries return hits", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", {
      ...searchFixtures,
      search_knowledge: (args) => {
        if ((args as { root: string }).root === FIXTURE_ROOT_FALL) {
          throw new Error("Search backend unavailable");
        }
        return searchByRoot(args);
      },
    });
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "diffusion");
    await waitFor(() => {
      expect(within(searchDialog()).getByText("Shared agenda")).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(within(searchDialog()).getByRole("status")).toHaveTextContent("Couldn't search Fall 2026");
      },
      { timeout: 10_000 },
    );
  });

  it("shows no failed-library notice when every library answers", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
    await waitForOverview();
    await openSearchPalette(user);
    await searchFor(user, "diffusion");
    await waitFor(() => {
      expect(within(searchDialog()).getByText("Shared agenda")).toBeInTheDocument();
    });
    expect(within(searchDialog()).queryByText(/Couldn't search/)).not.toBeInTheDocument();
  });

  it("shows a destructive error row when search fails", async () => {
    await renderAppAtRoute("/course/cell-biology/overview", {
      search_knowledge: () => {
        throw new Error("Search backend unavailable");
      },
    });
    await waitForOverview();
    const user = userEvent.setup();
    await openSearchPalette(user);
    await user.type(within(searchDialog()).getByLabelText("Search digests"), "membrane");
    await waitFor(
      () => {
        expect(within(searchDialog()).getByText("Search backend unavailable")).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
  });

  it("shows a loading row while search is in flight", async () => {
    let resolveSearch: ((value: unknown) => void) | undefined;
    const pending = new Promise((resolve) => {
      resolveSearch = resolve;
    });
    await renderAppAtRoute("/course/cell-biology/overview", {
      search_knowledge: () => pending,
    });
    await waitForOverview();
    const user = userEvent.setup();
    await openSearchPalette(user);
    await user.type(within(searchDialog()).getByLabelText("Search digests"), "membrane");
    await waitFor(() => {
      expect(within(searchDialog()).getByText("Searching…")).toBeInTheDocument();
    });
    resolveSearch?.([]);
    await waitFor(() => {
      expect(within(searchDialog()).queryByText("Searching…")).not.toBeInTheDocument();
    });
  });

  it("clears query and results when the active root changes while open", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
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
    queryClient.setQueryData(qk.settings(), {
      ...fixtureSettings,
      active_root: FIXTURE_ROOT_SHARED,
    });
    await waitFor(() => {
      expect(within(searchDialog()).getByLabelText("Search digests")).toHaveValue("");
      expect(within(searchDialog()).getByText("Type to search every class")).toBeInTheDocument();
      expect(within(searchDialog()).queryByText("Cell membranes")).not.toBeInTheDocument();
    });
  });

  it("clears query when the active root changes after close", async () => {
    const user = userEvent.setup();
    const { router, queryClient } = await renderAppAtRoute("/course/cell-biology/overview", searchFixtures);
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
      expect(router.state.location.pathname).toContain("/course/collab-notes/overview");
    });
    queryClient.setQueryData(qk.settings(), {
      ...fixtureSettings,
      active_root: FIXTURE_ROOT_SHARED,
    });
    await openSearchPalette(user);
    await waitFor(() => {
      expect(within(searchDialog()).getByLabelText("Search digests")).toHaveValue("");
      expect(within(searchDialog()).getByText("Type to search every class")).toBeInTheDocument();
    });
  });
});
