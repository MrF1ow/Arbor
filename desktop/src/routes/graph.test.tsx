import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

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
import { renderAppAtRoute } from "~/test/render";
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
      expect(screen.getByText(/2 concepts/i)).toBeInTheDocument();
    },
    { timeout: 8000 },
  );
}

function installVariableWidthResizeObserver(initialWidth: number) {
  const OriginalRO = globalThis.ResizeObserver;
  let width = initialWidth;
  const callbacks: Array<{ el: Element; cb: ResizeObserverCallback; ro: ResizeObserver }> = [];

  class MockResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      Object.defineProperty(el, "clientWidth", {
        configurable: true,
        get: () => width,
      });
      this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver);
      callbacks.push({ el, cb: this.cb, ro: this as unknown as ResizeObserver });
    }
    disconnect() {}
    unobserve() {}
  }

  globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;

  return {
    setWidth(next: number) {
      width = next;
      for (const { el, cb, ro } of callbacks) {
        Object.defineProperty(el, "clientWidth", {
          configurable: true,
          get: () => width,
        });
        cb([{ target: el } as ResizeObserverEntry], ro);
      }
    },
    restore() {
      globalThis.ResizeObserver = OriginalRO;
    },
  };
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

  it("renders concept list with figure and unverified styling", async () => {
    await renderAppAtRoute("/course/cell-biology/graph", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        if (readStudyFile(payload) === "citations.json") {
          return {
            schema_version: 1,
            course: readStudyCourse(payload),
            failures: [
              {
                path: "study/concepts.json",
                id: "concept-1",
                reason: "Missing citation anchor",
              },
            ],
          };
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    const list = screen.getByRole("navigation", { name: /Concepts/i });
    expect(within(list).getByRole("button", { name: /Facilitated diffusion/i })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /Figure · Figure 3\.2/i })).toBeInTheDocument();
    expect(within(list).getByText("Unverified")).toBeInTheDocument();
    const figureRow = within(list).getByRole("button", { name: /Figure · Figure 3\.2/i });
    expect(figureRow.className).toMatch(/border-dashed/);

    const user = userEvent.setup();
    await user.hover(within(list).getByText("Unverified"));
    await waitFor(() => {
      expect(screen.getByText("Missing citation anchor")).toBeInTheDocument();
    });
  });

  it("selects list rows and updates concept search param", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/graph", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    const list = screen.getByRole("navigation", { name: /Concepts/i });
    await user.click(within(list).getByRole("button", { name: /Figure · Figure 3\.2/i }));
    await waitFor(() => {
      expect(router.state.location.searchStr).toContain("concept=concept-2");
    });
    expect(screen.getByRole("heading", { name: /Figure · Figure 3\.2/i })).toBeInTheDocument();
  });

  it("selects neighbor chips", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/graph?concept=concept-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    await user.click(screen.getByRole("button", { name: /Figure 3\.2 · illustrates/i }));
    await waitFor(() => {
      expect(router.state.location.searchStr).toContain("concept=concept-2");
    });
  });

  it("navigates source chips to notes digest with heading", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/graph?concept=concept-1", {
      read_study_json: (payload) => {
        if (readStudyFile(payload) === "concepts.json") {
          return conceptGraph;
        }
        return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
      },
    });
    await waitForGraphReady();
    await user.click(
      screen.getByRole("button", { name: /Cell membranes · Membrane structure/i }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
      expect(router.state.location.searchStr).toMatch(/heading=Membrane(\+|%20)structure/);
    });
  });

  it("lands on concept from notes chip and falls back unknown ids", async () => {
    const user = userEvent.setup();
    const { router: fromNotes } = await renderAppAtRoute(
      "/course/cell-biology/notes/2026-09-12-membranes",
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
      expect(fromNotes.state.location.pathname).toContain("/graph");
      expect(fromNotes.state.location.searchStr).toContain("concept=concept-1");
    });

    cleanup();
    clearMocks();
    const { router } = await renderAppAtRoute("/course/cell-biology/graph?concept=missing-id", {
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
    expect(screen.getByRole("heading", { name: /Facilitated diffusion/i })).toBeInTheDocument();
  });

  it("moves selection with arrow keys and ignores typing and dialogs", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/graph?concept=concept-1", {
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
    const { router } = await renderAppAtRoute("/course/cell-biology/graph?concept=concept-1", {
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
    await renderAppAtRoute("/course/cell-biology/graph?concept=concept-1", {
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
    const { router } = await renderAppAtRoute("/course/cell-biology/graph?concept=concept-2", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/graph", {
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
    expect(screen.getByText(/2 concepts/i)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /Concepts/i })).toBeInTheDocument();
    resolvePending(conceptGraph);
    await waitForGraphReady();
  });

  it("keeps the graph when a refetch fails but cached data remains", async () => {
    let fetchCount = 0;
    const { queryClient } = await renderAppAtRoute("/course/cell-biology/graph", {
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
    expect(screen.getByText(/2 concepts/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/No concept graph yet for Cell Biology/i),
    ).not.toBeInTheDocument();
  });

  it("logs concept job started", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    clearMocks();
    useJobStore.setState({ status: "idle", activeJobId: null });
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    clearMocks();
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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
    await renderAppAtRoute("/course/cell-biology/graph", {
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

  it("opens narrow concept list sheet", async () => {
    const ro = installVariableWidthResizeObserver(500);
    const user = userEvent.setup();
    try {
      await renderAppAtRoute("/course/cell-biology/graph", {
        read_study_json: (payload) => {
          if (readStudyFile(payload) === "concepts.json") {
            return conceptGraph;
          }
          return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
        },
      });
      await waitForGraphReady();
      expect(screen.queryByRole("navigation", { name: /Concepts/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^Concepts$/i }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      expect(screen.getByRole("navigation", { name: /Concepts/i })).toBeInTheDocument();
    } finally {
      ro.restore();
    }
  });

  it("closes the concept sheet after widening past the narrow breakpoint", async () => {
    const ro = installVariableWidthResizeObserver(500);
    const user = userEvent.setup();
    try {
      await renderAppAtRoute("/course/cell-biology/graph", {
        read_study_json: (payload) => {
          if (readStudyFile(payload) === "concepts.json") {
            return conceptGraph;
          }
          return { schema_version: 1, course: readStudyCourse(payload), failures: [] };
        },
      });
      await waitForGraphReady();
      await user.click(screen.getByRole("button", { name: /^Concepts$/i }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      ro.setWidth(900);
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      ro.setWidth(500);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      ro.restore();
    }
  });
});
