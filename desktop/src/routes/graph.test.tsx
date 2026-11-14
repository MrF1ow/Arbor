import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { qk } from "~/lib/queries/keys";
import {
  FIXTURE_ROOT_FALL,
  fixtureConceptGraph,
  fixtureSettings,
} from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
} from "~/test/mock-handlers";
import { useJobStore } from "~/stores/job-store";
import { classScopeKey, useLectureSelectionStore } from "~/stores/lecture-selection-store";
import { renderAppAtRoute } from "~/test/render";

const layoutCalls = vi.hoisted(() => ({ count: 0, widths: [] as (number | undefined)[] }));
vi.mock("~/components/graph/graph-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/components/graph/graph-layout")>();
  return {
    ...real,
    layoutConcepts: (...args: Parameters<typeof real.layoutConcepts>) => {
      layoutCalls.count += 1;
      layoutCalls.widths.push(args[2]);
      return real.layoutConcepts(...args);
    },
  };
});
import { useUiStore } from "~/stores/ui-store";

function readStudyFile(payload: unknown): string {
  return String((payload as Record<string, unknown>).file ?? "");
}

function readStudyCourse(payload: unknown): string {
  return String((payload as Record<string, unknown>).course ?? "");
}

const conceptGraph = fixtureConceptGraph;

async function waitForGraphReady() {
  await waitFor(
    () => {
      expect(screen.getByTestId("graph-view")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Refresh concepts/i })).toBeInTheDocument();
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

describe("graph PR10", { timeout: 20000 }, () => {
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

  const withGraph = (extra: Record<string, unknown> = {}) => ({
    read_study_json: (payload: unknown) => {
      if (readStudyFile(payload) === "concepts.json") {
        return conceptGraph;
      }
      return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
    },
    ...extra,
  });

  it("draws a pill per concept, figures dashed, with a link between neighbours", async () => {
    await renderAppAtRoute("/course/cell-biology/map", withGraph());
    await waitForGraphReady();
    const canvas = screen.getByTestId("concept-canvas");
    expect(within(canvas).getByRole("button", { name: "Facilitated diffusion" })).toBeInTheDocument();
    const figure = within(canvas).getByRole("button", { name: "Figure · Figure 3.2" });
    expect(figure.className).toMatch(/border-dashed/);
    expect(canvas.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("shows the concept, its neighbours and its sources in side panels", async () => {
    await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", withGraph());
    await waitForGraphReady();
    const concept = screen.getByRole("region", { name: "Concept" });
    expect(within(concept).getByRole("heading", { level: 2, name: "Facilitated diffusion" })).toBeInTheDocument();
    expect(within(concept).getByText("Carrier-mediated passive transport.")).toBeInTheDocument();
    const neighbors = screen.getByRole("region", { name: "Neighbors" });
    expect(within(neighbors).getByRole("button", { name: /Figure 3\.2/ })).toBeInTheDocument();
    const sources = screen.getByRole("region", { name: "Sources" });
    expect(within(sources).getByText("Cell membranes")).toBeInTheDocument();
    expect(within(sources).getByRole("button", { name: "Read in digest" })).toBeInTheDocument();
  });

  it("flags an unverified concept in its panel with the reason on hover", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", {
      read_study_json: (payload: unknown) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        if (readStudyFile(payload) === "citations.json") {
          return {
            schema_version: 1,
            course: readStudyCourse(payload),
            failures: [{ path: "study/concepts.json", id: "concept-1", reason: "Missing citation anchor" }],
          };
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    const concept = screen.getByRole("region", { name: "Concept" });
    await user.hover(within(concept).getByText("Unverified"));
    await waitFor(() => expect(screen.getByText("Missing citation anchor")).toBeInTheDocument());
  });

  it("selects a concept by clicking its pill and updates the concept search param", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/map", withGraph());
    await waitForGraphReady();
    await user.click(within(screen.getByTestId("concept-canvas")).getByRole("button", { name: "Figure · Figure 3.2" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/map");
      expect(router.state.location.searchStr).toContain("concept=concept-2");
    });
    expect(screen.getByRole("heading", { level: 2, name: "Figure · Figure 3.2" })).toBeInTheDocument();
  });

  it("selects a neighbour from the Neighbors panel", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", withGraph());
    await waitForGraphReady();
    await user.click(within(screen.getByRole("region", { name: "Neighbors" })).getByRole("button", { name: /Figure 3\.2/ }));
    await waitFor(() => {
      expect(router.state.location.searchStr).toContain("concept=concept-2");
    });
  });

  it("opens a source in Read at its heading, and Read in digest opens the first source", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", withGraph());
    await waitForGraphReady();
    const sources = screen.getByRole("region", { name: "Sources" });
    await user.click(within(sources).getByRole("button", { name: /Membrane structure/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/read/2026-09-12-membranes");
      expect(router.state.location.searchStr).toMatch(/heading=Membrane(\+|%20)structure/);
    });
    await router.navigate({ to: "/course/$course/map", params: { course: "cell-biology" }, search: { concept: "concept-1" } });
    await user.click(await screen.findByRole("button", { name: "Read in digest" }));
    await waitFor(() => expect(router.state.location.pathname).toContain("/read/2026-09-12-membranes"));
  });

  it("zooms with the + and - buttons and fits the whole map again", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", withGraph());
    await waitForGraphReady();
    const canvas = screen.getByTestId("concept-canvas");
    const zoom = () => Number(canvas.getAttribute("data-zoom"));
    const start = zoom();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toBeGreaterThan(start);
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoom()).toBeLessThan(start);
    await user.click(screen.getByRole("button", { name: "Fit" }));
    expect(zoom()).toBe(start);
  });

  it("counts the concepts, links and digests in the bar above", async () => {
    await renderAppAtRoute("/course/cell-biology/map", withGraph());
    await waitForGraphReady();
    expect(await screen.findByText("2 concepts · 1 link · from 1 digest")).toBeInTheDocument();
  });

  it("highlights the concepts of the ticked lectures (Show on map)", async () => {
    useLectureSelectionStore.setState({ byClass: {} });
    useLectureSelectionStore
      .getState()
      .setScope(classScopeKey(FIXTURE_ROOT_FALL, "cell-biology"), ["cell-biology/digests/2026-09-15-mitochondria.md"]);
    const graph = {
      ...conceptGraph,
      nodes: [
        conceptGraph.nodes[0]!,
        { ...conceptGraph.nodes[1]!, sources: [{ digest: "digests/2026-09-15-mitochondria.md", heading: null }] },
      ],
    };
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload: unknown) =>
        readStudyFile(payload) === "concepts.json"
          ? graph
          : { schema_version: 1, course: readStudyCourse(payload), failures: [] },
    });
    await waitForGraphReady();
    const canvas = screen.getByTestId("concept-canvas");
    expect(within(canvas).getByRole("button", { name: "Figure · Figure 3.2" })).toHaveAttribute("data-highlighted", "true");
    expect(within(canvas).getByRole("button", { name: "Facilitated diffusion" })).toHaveAttribute("data-highlighted", "false");
    // The preview bar keeps the totals; the scope count sits with the legend (design frame 4842).
    expect(await screen.findByText("2 concepts · 1 link · from 2 digests")).toBeInTheDocument();
    expect(within(canvas).getByText("1 of 2 concepts in the selected lecture")).toBeInTheDocument();
  });

  it("lays the graph out once, not again on every concept click", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", withGraph());
    await waitForGraphReady();
    const canvas = screen.getByTestId("concept-canvas");
    const before = layoutCalls.count;
    await user.click(within(canvas).getByRole("button", { name: "Figure · Figure 3.2" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Figure · Figure 3.2" })).toBeInTheDocument(),
    );
    await user.click(within(canvas).getByRole("button", { name: "Facilitated diffusion" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Facilitated diffusion" })).toBeInTheDocument(),
    );
    expect(layoutCalls.count).toBe(before);
  });

  it("lays the map out for the measured canvas width, again when it changes, and not on a click (C29)", async () => {
    const user = userEvent.setup();
    let width = 600;
    const offset = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => width);
    const resizes: (() => void)[] = [];
    class StubObserver {
      constructor(callback: ResizeObserverCallback) {
        resizes.push(() => callback([], this as unknown as ResizeObserver));
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", StubObserver);
    try {
      await renderAppAtRoute("/course/cell-biology/map", withGraph());
      await waitForGraphReady();
      // the canvas width less room for a scrollbar, rounded down to a multiple of 8
      await waitFor(() => expect(layoutCalls.widths.at(-1)).toBe(584));
      width = 480;
      resizes.forEach((resize) => resize());
      await waitFor(() => expect(layoutCalls.widths.at(-1)).toBe(464));
      width = 482; // a few px more rounds to the same width: no new layout
      const before = layoutCalls.count;
      resizes.forEach((resize) => resize());
      const canvas = screen.getByTestId("concept-canvas");
      await user.click(within(canvas).getByRole("button", { name: "Facilitated diffusion" }));
      expect(layoutCalls.count).toBe(before);
    } finally {
      vi.unstubAllGlobals();
      offset.mockRestore();
    }
  });

  it("draws a source's slide as a citation chip, and lists neighbours without a relation label", async () => {
    await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", withGraph());
    await waitForGraphReady();
    const sources = screen.getByRole("region", { name: "Sources" });
    const chip = within(sources).getByRole("button", { name: "Membrane structure" });
    expect(chip.className).toMatch(/border-info/);
    expect(chip.className).toMatch(/text-info/);
    expect(chip.className).toMatch(/text-micro/);
    const neighbors = screen.getByRole("region", { name: "Neighbors" });
    expect(within(neighbors).queryByText("illustrates")).not.toBeInTheDocument();
  });

  it("scrolls a concept picked in Neighbors into view in the scrolling canvas (F114)", async () => {
    const user = userEvent.setup();
    // The canvas is a small scrolling viewport (jsdom has no layout): a pill below the fold needs a scroll.
    const size = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
    const wide = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(40);
    const scrollTo = vi.fn();
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
    try {
      await renderAppAtRoute("/course/cell-biology/map", withGraph());
      await waitForGraphReady();
      scrollTo.mockClear();
      await user.click(within(screen.getByRole("region", { name: "Neighbors" })).getAllByRole("button")[0]!);
      await waitFor(() => expect(scrollTo).toHaveBeenCalled());
      const [target] = scrollTo.mock.calls.at(-1)!;
      expect(target.top).toBeGreaterThan(0);
      expect(Number.isFinite(target.left)).toBe(true);
    } finally {
      Element.prototype.scrollTo = original;
      size.mockRestore();
      wide.mockRestore();
    }
  });

  it("highlights nothing when no lecture is ticked", async () => {
    useLectureSelectionStore.setState({ byClass: {} });
    await renderAppAtRoute("/course/cell-biology/map", withGraph());
    await waitForGraphReady();
    const pills = within(screen.getByTestId("concept-canvas")).getAllByRole("button", { name: /Facilitated|Figure/ });
    for (const pill of pills) {
      expect(pill).not.toHaveAttribute("data-highlighted", "true");
    }
  });

  it("lands on concept from notes chip and falls back unknown ids", async () => {
    const user = userEvent.setup();
    const { router: fromNotes } = await renderAppAtRoute(
      "/course/cell-biology/read/2026-09-12-membranes",
    );
    await waitFor(() => expect(screen.getByTestId("digest-view")).toBeInTheDocument(), {
      timeout: 8000,
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: "Facilitated diffusion" })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: "Facilitated diffusion" }));
    await waitFor(() => {
      expect(fromNotes.state.location.pathname).toContain("/map");
      expect(fromNotes.state.location.searchStr).toContain("concept=concept-1");
    });

    cleanup();
    clearTauriMocks();
    const { router } = await renderAppAtRoute("/course/cell-biology/map?concept=missing-id", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    await waitFor(() => {
      expect(router.state.location.searchStr).toMatch(/concept=concept-1/);
    });
    expect(
      screen.getByRole("heading", { level: 2, name: /Facilitated diffusion/i }),
    ).toBeInTheDocument();
  });

  it("moves selection with arrow keys and ignores typing and dialogs", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(router.state.location.searchStr).toContain("concept=concept-2");
    });
    await user.keyboard("{ArrowUp}");
    await waitFor(() => {
      expect(router.state.location.searchStr).toContain("concept=concept-1");
    });
    await user.keyboard("{ArrowUp}");
    expect(router.state.location.searchStr).toContain("concept=concept-1");

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await user.keyboard("{ArrowDown}");
    document.body.removeChild(input);
    expect(router.state.location.searchStr).toContain("concept=concept-1");

    const overlay = document.createElement("div");
    overlay.setAttribute("data-slot", "dialog-overlay");
    overlay.setAttribute("data-open", "");
    document.body.appendChild(overlay);
    await user.keyboard("{ArrowDown}");
    expect(router.state.location.searchStr).toContain("concept=concept-1");
    overlay.remove();

    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    expect(router.state.location.searchStr).toContain("concept=concept-1");
  });

  it("uses replace navigation without growing history", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    const historyLen = router.history.length;
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(router.state.location.searchStr).toContain("concept=concept-2");
    });
    expect(router.history.length).toBe(historyLen);
  });

  it("shows no linked concepts when the node has no neighbors", async () => {
    const loneNodeGraph = {
      ...conceptGraph,
      nodes: [conceptGraph.nodes[0]!],
      edges: [],
    };
    await renderAppAtRoute("/course/cell-biology/map?concept=concept-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return loneNodeGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(() => {
      expect(screen.getByText("No linked concepts.")).toBeInTheDocument();
    });
  });

  it("keeps selection on ArrowDown at the last list row", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/map?concept=concept-2", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    await user.keyboard("{ArrowDown}");
    expect(router.state.location.searchStr).toContain("concept=concept-2");
  });

  it("shows empty state copy and job payloads with gates", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(
          screen.getByText(
            /No concept graph yet for Cell Biology\. Generate concepts from your digests\./,
          ),
        ).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Generate concepts/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    let call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((call?.args as { skill?: string; course?: string; force?: boolean }).skill).toBe(
      "concepts",
    );
    expect((call?.args as { course?: string }).course).toBe("cell-biology");
    expect((call?.args as { force?: boolean }).force).toBe(false);

    useJobStore.setState({ status: "idle", activeJobId: null });
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Generate diagrams/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((call?.args as { skill?: string }).skill).toBe("diagrams");
    expect((call?.args as { force?: boolean }).force).toBe(false);
  });

  it("refresh concepts and diagrams use force true", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      study_artifact_stale: () => true,
    });
    await waitForGraphReady();
    expect(screen.getByText(/Digests updated since last generation/i)).toBeInTheDocument();
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Refresh concepts/i }));
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"));
    let call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((call?.args as { force?: boolean }).force).toBe(true);
    expect((call?.args as { skill?: string }).skill).toBe("concepts");

    useJobStore.setState({ status: "idle", activeJobId: null });
    clearMockIpcLog();
    await user.click(screen.getByRole("button", { name: /Refresh diagrams/i }));
    await waitFor(() => expect(getMockIpcCalls().some((c) => c.cmd === "start_study_job")).toBe(true));
    call = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((call?.args as { force?: boolean }).force).toBe(true);
    expect((call?.args as { skill?: string }).skill).toBe("diagrams");
  });

  it("shows empty state when concepts payload fails parseConceptGraph", async () => {
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return { schema_version: 1, course: "cell-biology", nodes: [], edges: [] };
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          /No concept graph yet for Cell Biology\. Generate concepts from your digests\./,
        ),
      ).toBeInTheDocument();
    });
  });

  it("keeps the graph visible while concepts refetch", async () => {
    let resolvePending: (value: unknown) => void = () => {};
    let fetchCount = 0;
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          fetchCount += 1;
          if (fetchCount > 1) {
            return new Promise((resolve) => {
              resolvePending = resolve;
            });
          }
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    void queryClient.invalidateQueries({
      queryKey: qk.studyJson(FIXTURE_ROOT_FALL, "cell-biology", "concepts.json"),
    });
    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(1);
    });
    expect(screen.getByTestId("concept-canvas")).toBeInTheDocument();
    resolvePending(conceptGraph);
    await waitForGraphReady();
  });

  it("keeps the graph when a refetch fails but cached data remains", async () => {
    let fetchCount = 0;
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          fetchCount += 1;
          if (fetchCount > 1) {
            throw new Error("refetch failed");
          }
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    await queryClient.invalidateQueries({
      queryKey: qk.studyJson(FIXTURE_ROOT_FALL, "cell-biology", "concepts.json"),
    });
    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(1);
    });
    expect(screen.getByTestId("concept-canvas")).toBeInTheDocument();
    expect(
      screen.queryByText(/No concept graph yet for Cell Biology/i),
    ).not.toBeInTheDocument();
  });

  it("logs concept job started", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /Generate concepts/i })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /Generate concepts/i }));
    await waitFor(() => {
      expect(useJobStore.getState().lines).toContain("Concept job mock-study-job started.");
    });
  });

  it("logs diagram job started", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /Generate diagrams/i })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /Generate diagrams/i }));
    await waitFor(() => {
      expect(useJobStore.getState().lines).toContain("Diagram job mock-study-job started.");
    });
  });

  it("logs concept job start failure", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      start_study_job: () => {
        throw new Error("boom");
      },
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /Generate concepts/i })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /Generate concepts/i }));
    await waitFor(() => {
      expect(useJobStore.getState().lines).toContain(
        "Concept generation failed to start: Error: boom",
      );
    });
  });

  it("logs diagram job start failure", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
      start_study_job: () => {
        throw new Error("diagram-boom");
      },
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /Generate diagrams/i })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /Generate diagrams/i }));
    await waitFor(() => {
      expect(useJobStore.getState().lines).toContain(
        "Diagram generation failed to start: Error: diagram-boom",
      );
    });
  });

  it("gates refresh concepts and diagram toolbar buttons", async () => {
    useJobStore.setState({ status: "running" });
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    expect(screen.getByRole("button", { name: /Refresh concepts/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Generate diagrams$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Refresh diagrams/i })).toBeDisabled();

    cleanup();
    clearTauriMocks();
    useJobStore.setState({ status: "idle", activeJobId: null });
    await renderAppAtRoute("/course/cell-biology/map", {
      get_settings: () => ({ ...fixtureSettings, model_id: null }),
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Refresh diagrams/i }));
    expect(screen.getByText("Select a model in Settings.")).toBeInTheDocument();

    cleanup();
    clearTauriMocks();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
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
    await waitForGraphReady();
    expect(screen.getByRole("button", { name: /Refresh concepts/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Generate diagrams$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Refresh diagrams/i })).toBeDisabled();
  });

  it("shows empty state on course mismatch", async () => {
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return { ...conceptGraph, course: "other-course" };
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          /No concept graph yet for Cell Biology\. Generate concepts from your digests\./,
        ),
      ).toBeInTheDocument();
    });
  });

  it("never flashes empty state while concepts load", async () => {
    const finishTracking = trackEmptyStateText(/No concept graph yet for/i);
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    expect(finishTracking()).toEqual([]);
  });

  it("disables generate for viewer libraries", async () => {
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
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
        expect(screen.getByRole("button", { name: /Generate concepts/i })).toBeDisabled();
      },
      { timeout: 8000 },
    );
  });

  it("shows Select a model when generating without a model", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      get_settings: () => ({ ...fixtureSettings, model_id: null }),
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /Generate concepts/i })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /Generate concepts/i }));
    expect(screen.getByText("Select a model in Settings.")).toBeInTheDocument();
  });

  it("blocks signed-out concept jobs without opening log", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
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
        expect(screen.getByRole("button", { name: /Generate concepts/i })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByRole("button", { name: /Generate concepts/i }));
    await waitFor(() => {
      expect(useJobStore.getState().lines.join("\n")).toMatch(/not authenticated/i);
    });
    expect(getMockIpcLog()).not.toContain("start_study_job");
    expect(useUiStore.getState().logOpen).toBe(false);
  });

  it("disables generate while a study job is running", async () => {
    useJobStore.setState({ status: "running" });
    await renderAppAtRoute("/course/cell-biology/map", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          throw new Error("ENOENT");
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /Generate concepts/i })).toBeDisabled();
      },
      { timeout: 8000 },
    );
  });
});
