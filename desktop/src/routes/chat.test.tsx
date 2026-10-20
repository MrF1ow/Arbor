import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks } from "@tauri-apps/api/mocks";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import {
  buildAssistantLine,
  buildSessionLine,
  buildUserLine,
} from "~/domain/chat";
import { ChatView } from "~/components/chat/chat-view";
import { FIXTURE_ROOT_FALL, fixtureDigests, fixtureSettings } from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
  type createMockHandler,
} from "~/test/mock-handlers";

type MockFixtures = Parameters<typeof createMockHandler>[0];

import {
  appendChatLiveDelta,
  chatLiveKey,
  resetChatLiveStoreForTests,
} from "~/stores/chat-live-store";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { renderAppAtRoute, renderWithProviders } from "~/test/render";
import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";
import { ChatTranscript } from "~/components/chat/chat-transcript";
import { LiveAnswer } from "~/components/chat/live-answer";
import { Profiler } from "react";

async function waitForChatReady() {
  await waitFor(
    () => {
      expect(screen.getByTestId("chat-view")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    },
    { timeout: 8000 },
  );
}

function renderChatViewMinimal(fixtures?: MockFixtures, seedSettings = fixtureSettings) {
  return renderWithProviders(
    <ChatView
      activeRoot={FIXTURE_ROOT_FALL}
      course="cell-biology"
      courses={["cell-biology"]}
      digests={fixtureDigests}
      roots={seedSettings.knowledge_roots}
      onSearchClear={() => undefined}
      onCourseChange={() => undefined}
    />,
    { minimal: true, seedSettings, fixtures },
  );
}

async function fillComposer(value: string) {
  const view = screen.getByTestId("chat-view");
  const textarea = within(view).getByLabelText("Chat message");
  fireEvent.change(textarea, { target: { value } });
  await waitFor(() => expect(textarea).toHaveValue(value));
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(within(view).getByRole("button", { name: "Send" })).not.toBeDisabled();
  });
}

describe("chat PR11", { timeout: 25000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    resetChatLiveStoreForTests();
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

  it("renders history with session boundaries, roles, and citation chips", async () => {
    await renderAppAtRoute("/course/cell-biology/chat", {
      read_chat_history: () => [
        buildUserLine("ask", "old question"),
        buildSessionLine(),
        buildUserLine("ask", "visible question"),
        buildAssistantLine("ask", "Visible **answer**", true, [
          {
            digest_path: "cell-biology/digests/2026-09-12-membranes.md",
            heading_id: "Membrane structure",
          },
        ]),
      ],
    });
    await waitForChatReady();
    await waitFor(() => {
      expect(screen.getByText("visible question")).toBeInTheDocument();
    });
    expect(screen.queryByText("old question")).not.toBeInTheDocument();
    expect(screen.getByText("answer", { selector: "strong" })).toBeInTheDocument();
    const cite = screen.getByRole("button", {
      name: /2026-09-12-membranes\.md · Membrane structure/i,
    });
    expect(cite).toBeInTheDocument();
  });

  it("Enter sends and Shift+Enter inserts a newline; streaming completes", async () => {
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    const textarea = within(screen.getByTestId("chat-view")).getByLabelText("Chat message");
    await fillComposer("Line one");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, code: "Enter" });
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);
    await fillComposer("Line one\nLine two");
    await userEvent.setup().click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true);
    });
    const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
    expect((start?.args as { mode?: string }).mode).toBe("ask");
    expect((start?.args as { question?: string }).question).toBe("Line one\nLine two");
    expect((start?.args as { provider?: string }).provider).toBe("grok");
    expect((start?.args as { model?: string }).model).toBe("grok-4.7");
    expect((start?.args as { history?: unknown[] }).history).toEqual([]);
    await waitFor(() => {
      expect(screen.getByTestId("chat-live-answer")).toHaveTextContent("Hello world!");
    });
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent("Done");
    });
    expect(screen.getByText("Mock answer", { selector: "strong" })).toBeInTheDocument();
    expect(getMockIpcCalls().filter((c) => c.cmd === "append_chat_lines").length).toBe(2);
  });

  it("blocks send when signed out or model missing", async () => {
    resetAuthRefreshForTests();
    const user = userEvent.setup();
    renderChatViewMinimal({
      check_auth: () =>
        Promise.resolve({
          authenticated: false,
          reason: "not logged in",
          docs_url: "",
        }),
    });
    await waitForChatReady();
    await fillComposer("Hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent(/not authenticated/);
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);

    cleanup();
    clearMockIpcLog();
    renderChatViewMinimal(
      {
        get_settings: () => ({ ...fixtureSettings, model_id: "" }),
      },
      { ...fixtureSettings, model_id: "" },
    );
    await waitForChatReady();
    await fillComposer("Hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent("Select a model in Settings.");
    });
  });

  it("surfaces auth_failed, error, and start_chat rejection", async () => {
    resetAuthRefreshForTests();
    const user = userEvent.setup();
    renderChatViewMinimal({
      start_chat: (args?: InvokeArgs) => {
        const channelId = parseMockChannelId((args as { onEvent?: unknown }).onEvent);
        if (channelId != null) {
          emitToChannel(channelId, { type: "auth_failed", reason: "token expired" }, 0);
          emitToChannel(channelId, { type: "worker_exit", code: 1 }, 1);
        }
        return null;
      },
    });
    await waitForChatReady();
    await fillComposer("Q");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent(/not authenticated: token expired/);
    });

    cleanup();
    clearMockIpcLog();
    renderChatViewMinimal({
      start_chat: (args?: InvokeArgs) => {
        const channelId = parseMockChannelId((args as { onEvent?: unknown }).onEvent);
        if (channelId != null) {
          emitToChannel(channelId, { type: "error", message: "Worker blew up" }, 0);
          emitToChannel(channelId, { type: "worker_exit", code: 1 }, 1);
        }
        return null;
      },
    });
    await waitForChatReady();
    await fillComposer("Q");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent("Worker blew up");
    });

    cleanup();
    clearMockIpcLog();
    renderChatViewMinimal({
      start_chat: () => {
        throw new Error("Grok is not authenticated");
      },
    });
    await waitForChatReady();
    await fillComposer("Q");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent(/not authenticated/);
    });
  });

  it("does not apply streaming deltas after switching course", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { router } = await renderAppAtRoute("/course/cell-biology/chat");
      await waitForChatReady();
      await fillComposer("Stream me");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await vi.advanceTimersByTimeAsync(35);
      await router.navigate({
        to: "/course/$course/chat",
        params: { course: "organic-chemistry-ii" },
      });
      await waitForChatReady();
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.queryByTestId("chat-live-answer")).not.toBeInTheDocument();
      expect(screen.queryByText("Hello world!")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("new chat hides earlier turns; clear history confirms", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat", {
      read_chat_history: () => [buildUserLine("ask", "before session")],
    });
    await waitForChatReady();
    await waitFor(() => {
      expect(screen.getByText("before session")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "append_chat_lines")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText("before session")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear history" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(getMockIpcCalls().some((c) => c.cmd === "clear_chat_history")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Clear history" }));
    const dialog2 = await screen.findByRole("alertdialog");
    await user.click(within(dialog2).getByRole("button", { name: "Clear history" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "clear_chat_history")).toBe(true);
    });
  });

  it("auto-sends explain weakest prompt once and clears search params", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const prompt =
        'Explain the weakest topic "Cytoskeleton". Stay inside this course and cite sources.';
      const { router } = await renderAppAtRoute(
        `/course/cell-biology/chat?mode=explain&prompt=${encodeURIComponent(prompt)}`,
      );
      await waitForChatReady();
      await vi.advanceTimersByTimeAsync(350);
      await waitFor(() => {
        expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true);
      });
      const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
      expect((start?.args as { mode?: string }).mode).toBe("explain");
      expect((start?.args as { question?: string }).question).toBe(prompt);
      expect(router.state.location.searchStr).not.toContain("prompt=");
      await vi.advanceTimersByTimeAsync(150);
      const starts = getMockIpcCalls().filter((c) => c.cmd === "start_chat");
      expect(starts.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes mode in start_chat payload from toggle", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat?mode=quiz");
    await waitForChatReady();
    await waitFor(() => {
      expect(
        within(screen.getByTestId("chat-view")).getByRole("button", { name: "Quiz mode" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    await fillComposer("Quiz time");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(
      () => {
        const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
        expect((start?.args as { mode?: string }).mode).toBe("quiz");
      },
      { timeout: 3000 },
    );
  });

  it("generate study artifact launches flashcard or quiz jobs", async () => {
    resetAuthRefreshForTests();
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "get_settings")).toBe(true);
    });
    clearMockIpcLog();
    resetAuthRefreshForTests();
    useJobStore.setState({ status: "idle", activeJobId: null, lines: [] });
    const generateBtn = screen.getByRole("button", { name: "Generate study artifact" });
    await waitFor(() => expect(generateBtn).not.toBeDisabled(), { timeout: 8000 });
    await user.click(generateBtn);
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"), { timeout: 5000 });
    const job = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((job?.args as { skill?: string }).skill).toBe("flashcards");
  });

  it("live deltas re-render LiveAnswer without re-rendering ChatTranscript", () => {
    resetChatLiveStoreForTests();
    let transcriptUpdates = 0;
    const lines = [buildUserLine("ask", "hello")];
    renderWithProviders(
      <Profiler
        id="chat-transcript"
        onRender={() => {
          transcriptUpdates += 1;
        }}
      >
        <ChatTranscript course="cell-biology" lines={lines} digests={[]} />
      </Profiler>,
      { minimal: true },
    );
    const initial = transcriptUpdates;
    act(() => {
      appendChatLiveDelta(chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology"), " streamed");
    });
    expect(transcriptUpdates).toBe(initial);

    cleanup();
    renderWithProviders(
      <LiveAnswer root={FIXTURE_ROOT_FALL} course="cell-biology" />,
      { minimal: true },
    );
    expect(screen.getByTestId("chat-live-answer")).toHaveTextContent("streamed");
    cleanup();
  });

  it("explain weakest from overview navigates and auto-sends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderAppAtRoute("/course/cell-biology/notes");
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Explain weakest topic/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /Explain weakest topic/i }));
      await waitForChatReady();
      await vi.advanceTimersByTimeAsync(350);
      await waitFor(() => {
        expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true);
      });
      const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
      expect((start?.args as { mode?: string }).mode).toBe("explain");
      expect((start?.args as { question?: string }).question).toBe(
        'Explain the weakest topic "Cytoskeleton". Stay inside this course and cite sources.',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
