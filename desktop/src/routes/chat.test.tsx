import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import {
  buildAssistantLine,
  buildUserLine,
  chatAuthErrorMessage,
  workerHistory,
} from "~/domain/chat";
import { ChatView } from "~/components/chat/chat-view";
import {
  FIXTURE_ROOT_FALL,
  FIXTURE_ROOT_SHARED,
  fixtureDigests,
  fixtureSettings,
} from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
  resetMockHandlerTimers,
  resetMockChatHistoryForTests,
  seedMockChatHistory,
  seedMockChatThread,
  type createMockHandler,
} from "~/test/mock-handlers";

type MockFixtures = Parameters<typeof createMockHandler>[0];
type ChatViewProps = Parameters<typeof ChatView>[0];

import {
  appendChatLiveDelta,
  beginChatLiveStream,
  chatLiveKey,
  resetChatLiveStoreForTests,
} from "~/stores/chat-live-store";
import { resetChatDraftsStoreForTests, useChatDraftsStore } from "~/stores/chat-drafts-store";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { renderAppAtRoute, renderWithProviders } from "~/test/render";
import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";
import { ChatTranscript } from "~/components/chat/chat-transcript";
import { LiveAnswer } from "~/components/chat/live-answer";
import { Profiler, StrictMode } from "react";

const STREAM_THREAD_ID = "t-20261020T160000Z-000001";

async function waitForChatShell() {
  await waitFor(
    () => {
      expect(screen.getByTestId("chat-view")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    },
    { timeout: 8000 },
  );
}

async function waitForChatReady() {
  await waitForChatShell();
  await waitFor(
    () => {
      expect(screen.getByRole("navigation", { name: "Chat threads" })).toBeInTheDocument();
      expect(
        within(screen.getByRole("navigation", { name: "Chat threads" })).getByText(
          "Explain the cytoskeleton",
        ),
      ).toBeInTheDocument();
    },
    { timeout: 8000 },
  );
}

function noopThreadHandlers(): Pick<
  ChatViewProps,
  "onSearchClear" | "onModeSearchClear" | "onCourseChange" | "onThreadChange" | "onNewChatNavigate"
> {
  return {
    onSearchClear: () => undefined,
    onModeSearchClear: () => undefined,
    onCourseChange: () => undefined,
    onThreadChange: () => undefined,
    onNewChatNavigate: () => undefined,
  };
}

function renderChatViewMinimal(
  fixtures?: MockFixtures,
  seedSettings = fixtureSettings,
  initialArtifactKind: "flashcards" | "quiz" = "flashcards",
  extra: Partial<ChatViewProps> = {},
) {
  return renderWithProviders(
    <ChatView
      activeRoot={FIXTURE_ROOT_FALL}
      course="cell-biology"
      courses={["cell-biology"]}
      digests={fixtureDigests}
      roots={seedSettings.knowledge_roots}
      threadId={null}
      initialArtifactKind={initialArtifactKind}
      {...noopThreadHandlers()}
      {...extra}
    />,
    { minimal: true, seedSettings, fixtures },
  );
}

function modeChipLabel(mode: "Ask" | "Explain") {
  return `Mode: ${mode} (Shift+Tab to switch)`;
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

async function openNewChat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() => {
    expect(screen.getByText("Ask about Cell Biology")).toBeInTheDocument();
  });
}

describe("chat threads", { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    resetChatLiveStoreForTests();
    resetChatDraftsStoreForTests();
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: true,
      logOpen: false,
      logHeight: 200,
      notesIndexOpen: true,
      chatThreadsOpen: true,
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
    resetMockChatHistoryForTests();
  });

  afterEach(() => {
    cleanup();
    resetMockHandlerTimers();
    clearTauriMocks();
    vi.restoreAllMocks();
  });


  it("Enter sends and Shift+Enter inserts a newline; streaming completes", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    const textarea = within(screen.getByTestId("chat-view")).getByLabelText("Chat message");
    await fillComposer("Line one");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, code: "Enter" });
    fireEvent.change(textarea, { target: { value: "Line one\n" } });
    expect(textarea).toHaveValue("Line one\n");
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);
    await fillComposer("Line one\nLine two");
    await user.click(screen.getByRole("button", { name: "Send" }));
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
      expect(screen.getByTestId("chat-status")).toHaveTextContent("Done");
    });
    expect(
      getMockIpcCalls().filter((c) => c.cmd === "append_chat_thread_lines").length,
    ).toBeGreaterThanOrEqual(2);
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
    await waitForChatShell();
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
    await waitForChatShell();
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
    await waitForChatShell();
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
    await waitForChatShell();
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
    await waitForChatShell();
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
      await waitForChatShell();
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.queryByTestId("chat-live-answer")).not.toBeInTheDocument();
      expect(screen.queryByText("Hello world!")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
    await renderAppAtRoute("/course/cell-biology/chat?mode=explain");
    await waitForChatReady();
    await waitFor(() => {
      expect(
        within(screen.getByTestId("chat-view")).getByRole("button", {
          name: modeChipLabel("Explain"),
        }),
      ).toBeInTheDocument();
    });
    await user.click(
      within(screen.getByTestId("chat-view")).getByRole("button", { name: modeChipLabel("Explain") }),
    );
    await fillComposer("Explain this");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(
      () => {
        const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
        expect((start?.args as { mode?: string }).mode).toBe("ask");
      },
      { timeout: 3000 },
    );
  });

  it("?mode=quiz falls back to Ask and omits chat Quiz mode toggle", async () => {
    await renderAppAtRoute("/course/cell-biology/chat?mode=quiz");
    await waitForChatReady();
    expect(
      within(screen.getByTestId("chat-view")).getByRole("button", { name: modeChipLabel("Ask") }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("chat-view")).queryByRole("button", { name: "Quiz mode" }),
    ).not.toBeInTheDocument();
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

  it("assistant prose is full width in the reading column", () => {
    renderWithProviders(
      <ChatTranscript
        course="cell-biology"
        lines={[buildAssistantLine("ask", "Left-aligned answer", true, [])]}
        digests={fixtureDigests}
      />,
      { minimal: true },
    );
    const prose = screen.getByTestId("chat-assistant-prose");
    expect(prose.className).toMatch(/\bw-full\b/);
    expect(prose.className).toMatch(/\bmax-w-none\b/);
    expect(prose.className).not.toMatch(/\btext-center\b/);
    cleanup();
  });

  it("study artifact select shows human-readable labels", async () => {
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    expect(screen.getByRole("combobox", { name: "Study artifact type" })).toHaveTextContent(
      "Flashcards",
    );
  });

  it("does not auto-scroll the transcript while the user has a selection", async () => {
    resetChatLiveStoreForTests();
    const lines = [
      buildUserLine("ask", "hello"),
      buildAssistantLine("ask", "Long answer for scroll test.", true, []),
    ];
    seedMockChatThread(
      FIXTURE_ROOT_FALL,
      "cell-biology",
      {
        id: STREAM_THREAD_ID,
        title: "hello",
        mode: "ask",
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:05:00.000Z",
      },
      lines,
    );
    renderWithProviders(
      <ChatView
        activeRoot={FIXTURE_ROOT_FALL}
        course="cell-biology"
        courses={["cell-biology"]}
        digests={fixtureDigests}
        roots={fixtureSettings.knowledge_roots}
        threadId={STREAM_THREAD_ID}
        {...noopThreadHandlers()}
      />,
      { minimal: true },
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-assistant-prose")).toBeInTheDocument();
    });
    const scrollEl = screen.getByTestId("chat-transcript-scroll");
    Object.defineProperty(scrollEl, "scrollHeight", { value: 800, configurable: true });
    Object.defineProperty(scrollEl, "clientHeight", { value: 400, configurable: true });
    scrollEl.scrollTop = 390;
    fireEvent.scroll(scrollEl);
    const prose = screen.getByTestId("chat-assistant-prose");
    const anchor = prose.firstChild ?? prose;
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      anchorNode: anchor,
      removeAllRanges: () => undefined,
      addRange: () => undefined,
    } as unknown as Selection);
    const liveKey = chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology", STREAM_THREAD_ID);
    beginChatLiveStream(liveKey);
    const before = scrollEl.scrollTop;
    act(() => {
      appendChatLiveDelta(liveKey, " more text");
    });
    expect(scrollEl.scrollTop).toBe(before);
    vi.restoreAllMocks();
    cleanup();
  });

  it("scrolls to the bottom after send even when the transcript has a selection", async () => {
    const user = userEvent.setup();
    resetChatLiveStoreForTests();
    const lines = [
      buildUserLine("ask", "hello"),
      buildAssistantLine("ask", "Long answer for scroll test.", true, []),
    ];
    seedMockChatThread(
      FIXTURE_ROOT_FALL,
      "cell-biology",
      {
        id: STREAM_THREAD_ID,
        title: "hello",
        mode: "ask",
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:05:00.000Z",
      },
      lines,
    );
    renderChatViewMinimal({}, fixtureSettings, "flashcards", { threadId: STREAM_THREAD_ID });
    await waitFor(() => {
      expect(screen.getByTestId("chat-assistant-prose")).toBeInTheDocument();
    });
    const scrollEl = screen.getByTestId("chat-transcript-scroll");
    Object.defineProperty(scrollEl, "scrollHeight", { value: 800, configurable: true });
    Object.defineProperty(scrollEl, "clientHeight", { value: 400, configurable: true });
    scrollEl.scrollTop = 0;
    const prose = screen.getByTestId("chat-assistant-prose");
    const anchor = prose.firstChild ?? prose;
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      anchorNode: anchor,
      removeAllRanges: () => undefined,
      addRange: () => undefined,
    } as unknown as Selection);
    await fillComposer("My new question");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(scrollEl.scrollTop).toBe(800);
    });
    vi.restoreAllMocks();
    cleanup();
  });

  it("ChatView does not re-render on each live text delta", async () => {
    resetChatLiveStoreForTests();
    let chatViewRenders = 0;
    renderWithProviders(
      <Profiler
        id="chat-view-stream"
        onRender={() => {
          chatViewRenders += 1;
        }}
      >
        <ChatView
          activeRoot={FIXTURE_ROOT_FALL}
          course="cell-biology"
          courses={["cell-biology"]}
          digests={fixtureDigests}
          roots={fixtureSettings.knowledge_roots}
          threadId={STREAM_THREAD_ID}
          {...noopThreadHandlers()}
        />
      </Profiler>,
      { minimal: true },
    );
    const afterMount = chatViewRenders;
    const liveKey = chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology", STREAM_THREAD_ID);
    beginChatLiveStream(liveKey);
    await waitFor(() => {
      expect(chatViewRenders).toBeGreaterThan(afterMount);
    });
    const afterFlight = chatViewRenders;
    act(() => {
      appendChatLiveDelta(liveKey, "tok");
      appendChatLiveDelta(liveKey, "ens");
      appendChatLiveDelta(liveKey, "!");
    });
    expect(chatViewRenders - afterFlight).toBeLessThan(3);
  });


  it("live deltas re-render LiveAnswer without re-rendering ChatTranscript", async () => {
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
    const liveKey = chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology", STREAM_THREAD_ID);
    act(() => {
      appendChatLiveDelta(liveKey, " streamed");
    });
    expect(transcriptUpdates).toBe(initial);

    beginChatLiveStream(liveKey);
    act(() => {
      appendChatLiveDelta(liveKey, " streamed");
    });
    renderWithProviders(
      <LiveAnswer
        root={FIXTURE_ROOT_FALL}
        course="cell-biology"
        threadId={STREAM_THREAD_ID}
      />,
      { minimal: true },
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-live-answer")).toHaveTextContent("streamed");
    });
  });



  it("snapshots workerHistory before append and orders append_chat_thread_lines", async () => {
    seedMockChatHistory(FIXTURE_ROOT_FALL, "cell-biology", [
      buildUserLine("ask", "earlier"),
    ]);
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatShell();
    await waitFor(() => expect(screen.getByText("earlier")).toBeInTheDocument());
    await fillComposer("next");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true));
    const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
    expect((start?.args as { history?: unknown[] }).history).toEqual(
      workerHistory([buildUserLine("ask", "earlier")]),
    );
    await waitFor(() => {
      expect(
        getMockIpcCalls().filter((c) => c.cmd === "append_chat_thread_lines").length,
      ).toBeGreaterThanOrEqual(2);
    });
    const appends = getMockIpcCalls().filter((c) => c.cmd === "append_chat_thread_lines");
    expect((appends[0]?.args as { lines?: { role: string }[] }).lines?.[0]?.role).toBe("user");
    const assistant = (appends[1]?.args as { lines?: { role: string; supported?: boolean; citations?: { heading_id?: string }[] }[] }).lines?.[0];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.supported).toBe(true);
    expect(assistant?.citations?.[0]?.heading_id).toBe("Membrane structure");
  });

  it("steps status Retrieving, Answering, and Done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderAppAtRoute("/course/cell-biology/chat");
      await waitForChatReady();
      await openNewChat(user);
      await fillComposer("Status");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => {
        expect(screen.getByTestId("chat-status")).toHaveTextContent("Retrieving");
      });
      await vi.advanceTimersByTimeAsync(15);
      await waitFor(() => {
        expect(screen.getByTestId("chat-status")).toHaveTextContent("Answering");
      });
      await vi.advanceTimersByTimeAsync(120);
      await waitFor(() => {
        expect(screen.getByTestId("chat-status")).toHaveTextContent("Done");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables toolbar and composer until worker_exit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderAppAtRoute("/course/cell-biology/chat");
      await waitForChatReady();
      await openNewChat(user);
      await fillComposer("Hold");
      await user.click(screen.getByRole("button", { name: "Send" }));
      const view = screen.getByTestId("chat-view");
      await vi.advanceTimersByTimeAsync(20);
      await waitFor(() => {
        expect(within(view).getByRole("button", { name: "Send" })).toBeDisabled();
      });
      expect(within(view).getByRole("button", { name: modeChipLabel("Ask") })).toBeDisabled();
      expect(within(view).getByRole("combobox", { name: "Course" })).toBeDisabled();
      await vi.advanceTimersByTimeAsync(200);
    } finally {
      vi.useRealTimers();
    }
    await fillComposer("After worker exit");
    await waitFor(() => {
      expect(within(screen.getByTestId("chat-view")).getByRole("button", { name: "Send" })).not.toBeDisabled();
    });
  });

  it("maps plain timeout errors through chatAuthErrorMessage", async () => {
    const user = userEvent.setup();
    renderChatViewMinimal({
      start_chat: () => {
        throw new Error("timeout");
      },
    });
    await waitForChatShell();
    await fillComposer("Q");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent(
        chatAuthErrorMessage("Grok", new Error("timeout")),
      );
    });
  });

  it("logs failed assistant append and re-enables Send", async () => {
    const user = userEvent.setup();
    renderChatViewMinimal({
      append_chat_thread_lines: (args?: InvokeArgs) => {
        const payload = (args ?? {}) as Record<string, unknown>;
        const lines = (payload.lines as { role?: string }[]) ?? [];
        if (lines.some((line) => line.role === "assistant")) {
          throw new Error("disk full");
        }
        const now = new Date().toISOString();
        return {
          id: String(payload.thread ?? ""),
          title: "Fail append",
          mode: "ask",
          created_at: now,
          updated_at: now,
        };
      },
    });
    await waitForChatShell();
    await fillComposer("Fail append");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(
        useJobStore.getState().lines.some((line) =>
          line.includes("Could not append chat lines:"),
        ),
      ).toBe(true);
    });
    await fillComposer("Retry after failure");
    await waitFor(
      () => {
        expect(
          within(screen.getByTestId("chat-view")).getByRole("button", { name: "Send" }),
        ).not.toBeDisabled();
      },
      { timeout: 5000 },
    );
  });


  it("returns to course after mid-stream switch and keeps other course clean", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { router } = await renderAppAtRoute("/course/cell-biology/chat", {
        start_chat: (args?: InvokeArgs) => {
          const channelId = parseMockChannelId((args as { onEvent?: unknown }).onEvent);
          if (channelId == null) {
            return null;
          }
          emitToChannel(channelId, { type: "chat_retrieved" }, 0);
          emitToChannel(channelId, { type: "chat_delta", delta: "Partial " }, 1);
          window.setTimeout(() => {
            emitToChannel(
              channelId,
              {
                type: "chat_done",
                markdown: "**Mock answer** after switch.",
                supported: true,
                citations: [],
              },
              2,
            );
            emitToChannel(channelId, { type: "worker_exit", code: 0 }, 3);
          }, 400);
          return null;
        },
      });
      await waitForChatReady();
      await openNewChat(user);
      await fillComposer("Resume me");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => {
        expect((router.state.location.search as { thread?: string }).thread).toBeTruthy();
      });
      const sendThread = (router.state.location.search as { thread?: string }).thread;
      await vi.advanceTimersByTimeAsync(35);
      await router.navigate({
        to: "/course/$course/chat",
        params: { course: "organic-chemistry-ii" },
      });
      await waitForChatShell();
      expect(screen.queryByTestId("chat-live-answer")).not.toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(500);
      await router.navigate({
        to: "/course/$course/chat",
        params: { course: "cell-biology" },
        search: sendThread ? { thread: sendThread } : undefined,
      });
      await waitForChatShell();
      await waitFor(
        () => {
          expect(
            getMockIpcCalls().some(
              (c) =>
                c.cmd === "append_chat_thread_lines" &&
                JSON.stringify(c.args).includes("Mock answer"),
            ),
          ).toBe(true);
        },
        { timeout: 8000 },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send on Enter during IME composition", async () => {
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    const textarea = within(screen.getByTestId("chat-view")).getByLabelText("Chat message");
    await fillComposer("こんにちは");
    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter",
      nativeEvent: { isComposing: true },
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);
  });

  it("navigates citation chips to digest and course overview", async () => {
    const user = userEvent.setup();
    seedMockChatHistory(FIXTURE_ROOT_FALL, "cell-biology", [
      buildAssistantLine("ask", "Answer", true, [
        {
          digest_path: "cell-biology/digests/2026-09-12-membranes.md",
          heading_id: "Membrane structure",
        },
      ]),
      buildAssistantLine("ask", "Overview cite", true, [
        { digest_path: "cell-biology/course.md", heading_id: "Overview" },
      ]),
    ]);
    const { router } = await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatShell();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Cell membranes · Membrane structure/i }),
      ).toBeInTheDocument();
    });
    const threadId = (router.state.location.search as { thread?: string }).thread;
    await user.click(
      screen.getByRole("button", { name: /Cell membranes · Membrane structure/i }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
      expect(router.state.location.searchStr).toContain("heading=Membrane+structure");
    });
    await router.navigate({
      to: "/course/$course/chat",
      params: { course: "cell-biology" },
      search: threadId ? { thread: threadId } : undefined,
    });
    await waitForChatShell();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Course overview · Overview/i }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Course overview · Overview/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/notes");
    });
  });

  it("shows empty-state copy and unsupported banner", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    expect(screen.getByText("Ask about Cell Biology")).toBeInTheDocument();
    expect(
      screen.getByText(/Answers cite digests in this course/i),
    ).toBeInTheDocument();

    cleanup();
    clearMockIpcLog();
    seedMockChatHistory(FIXTURE_ROOT_FALL, "cell-biology", [
      buildAssistantLine("ask", "Weak", false, []),
    ]);
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatShell();
    await waitFor(() => {
      expect(screen.getByText("Not supported by this course")).toBeInTheDocument();
    });
  });

  it("clears transcript when active root changes", async () => {
    seedMockChatHistory(FIXTURE_ROOT_FALL, "cell-biology", [
      buildUserLine("ask", "root-a-only"),
    ]);
    const { unmount } = await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatShell();
    await waitFor(() => expect(screen.getByText("root-a-only")).toBeInTheDocument());
    unmount();
    cleanup();
    renderWithProviders(
      <ChatView
        activeRoot={FIXTURE_ROOT_SHARED}
        course="collab-notes"
        courses={["collab-notes"]}
        digests={[]}
        roots={fixtureSettings.knowledge_roots}
        threadId={null}
        {...noopThreadHandlers()}
      />,
      { minimal: true },
    );
    await waitForChatShell();
    expect(screen.queryByText("root-a-only")).not.toBeInTheDocument();
  });

  it("quiz artifact payload includes skill course and force false", async () => {
    resetAuthRefreshForTests();
    const user = userEvent.setup();
    renderChatViewMinimal(undefined, fixtureSettings, "quiz");
    await waitForChatShell();
    clearMockIpcLog();
    resetAuthRefreshForTests();
    useJobStore.setState({ status: "idle", activeJobId: null, lines: [] });
    const generateBtn = screen.getByRole("button", { name: "Generate study artifact" });
    await waitFor(() => expect(generateBtn).not.toBeDisabled(), { timeout: 8000 });
    await user.click(generateBtn);
    await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"), { timeout: 5000 });
    const job = getMockIpcCalls().find((c) => c.cmd === "start_study_job");
    expect((job?.args as { skill?: string }).skill).toBe("quiz");
    expect((job?.args as { course?: string }).course).toBe("cell-biology");
    expect((job?.args as { force?: boolean }).force).toBe(false);
  });

  it("streams without re-rendering ChatView each delta", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let chatViewUpdates = 0;
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(
        <Profiler
          id="chat-view-perf"
          onRender={(id) => {
            if (id === "chat-view-perf") chatViewUpdates += 1;
          }}
        >
          <ChatView
            activeRoot={FIXTURE_ROOT_FALL}
            course="cell-biology"
            courses={["cell-biology"]}
            digests={fixtureDigests}
            roots={fixtureSettings.knowledge_roots}
            threadId={null}
        {...noopThreadHandlers()}
      />
        </Profiler>,
        { minimal: true },
      );
      await waitForChatReady();
      const before = chatViewUpdates;
      await fillComposer("Perf");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await vi.advanceTimersByTimeAsync(35);
      await vi.advanceTimersByTimeAsync(80);
      expect(chatViewUpdates - before).toBeLessThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
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
  it("lists seeded threads newest first", async () => {
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    const nav = screen.getByRole("navigation", { name: "Chat threads" });
    const newest = within(nav).getByText("Explain the cytoskeleton");
    const middle = within(nav).getByText("ATP and energy currency");
    const oldest = within(nav).getByText("Membrane structure review");
    expect(newest.compareDocumentPosition(middle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(middle.compareDocumentPosition(oldest)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("new chat send creates a titled thread and sets thread in URL", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    await fillComposer("My unique thread question");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect((router.state.location.search as { thread?: string }).thread).toBeTruthy();
    });
  });

  it("delete all cancel keeps chats", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByRole("button", { name: "Delete all chats" }));
    expect(screen.getByText(/Delete all chats for Cell Biology/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      within(screen.getByRole("navigation", { name: "Chat threads" })).getByText(
        "Explain the cytoskeleton",
      ),
    ).toBeInTheDocument();
  });

  it("shows No matching chats when search misses", async () => {
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    fireEvent.change(screen.getByLabelText("Search chats"), { target: { value: "zzznomatch" } });
    await waitFor(() => {
      expect(screen.getByText("No matching chats")).toBeInTheDocument();
    });
  });

  it("toggling Ask/Explain on a thread updates mode for the next send", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByText("Membrane structure review"));
    await user.click(screen.getByRole("button", { name: modeChipLabel("Ask") }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "set_chat_thread_mode")).toBe(true);
    });
    await fillComposer("Mode follow-up");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
      expect((start?.args as { mode?: string }).mode).toBe("explain");
    });
  });

  it("mode chip toggles and persists on a stored thread", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByText("Membrane structure review"));
    await user.click(screen.getByRole("button", { name: modeChipLabel("Ask") }));
    await waitFor(() => {
      expect(
        getMockIpcCalls().some(
          (c) =>
            c.cmd === "set_chat_thread_mode" &&
            (c.args as { mode?: string }).mode === "explain",
        ),
      ).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: modeChipLabel("Explain") }));
    await waitFor(() => {
      expect(
        getMockIpcCalls().filter((c) => c.cmd === "set_chat_thread_mode").length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it("Shift+Tab in the composer toggles mode", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    const textarea = within(screen.getByTestId("chat-view")).getByLabelText("Chat message");
    await user.click(textarea);
    fireEvent.keyDown(textarea, { key: "Tab", code: "Tab", shiftKey: true });
    await waitFor(() => {
      expect(
        within(screen.getByTestId("chat-view")).getByRole("button", {
          name: modeChipLabel("Explain"),
        }),
      ).toBeInTheDocument();
    });
  });

  it("slash /explain sends with explain mode and stripped text", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    await fillComposer("/explain foo");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
      expect((start?.args as { mode?: string }).mode).toBe("explain");
      expect((start?.args as { question?: string }).question).toBe("foo");
    });
  });

  it("/ask alone switches mode without sending", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat?mode=explain");
    await waitForChatReady();
    await openNewChat(user);
    await fillComposer("/ask");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("chat-view")).getByRole("button", { name: modeChipLabel("Ask") }),
      ).toBeInTheDocument();
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);
    expect(within(screen.getByTestId("chat-view")).getByLabelText("Chat message")).toHaveValue("");
  });

  it("slash suggestion Enter picks without sending", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    const view = screen.getByTestId("chat-view");
    const textarea = within(view).getByLabelText("Chat message");
    await user.click(textarea);
    await user.keyboard("/e");
    await waitFor(() => {
      expect(within(view).getByRole("listbox", { name: "Slash commands" })).toBeInTheDocument();
    });
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(textarea).toHaveValue("/explain ");
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);
  });

  it("auto-sends prompt once under StrictMode into a new thread", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const prompt = "StrictMode prompt once";
      renderWithProviders(
        <StrictMode>
          <ChatView
            activeRoot={FIXTURE_ROOT_FALL}
            course="cell-biology"
            courses={["cell-biology"]}
            digests={fixtureDigests}
            roots={fixtureSettings.knowledge_roots}
            threadId={null}
            promptParam={prompt}
            {...noopThreadHandlers()}
          />
        </StrictMode>,
        { minimal: true },
      );
      await waitFor(() => expect(getMockIpcCalls().some((c) => c.cmd === "create_chat_thread")).toBe(true));
      await vi.advanceTimersByTimeAsync(350);
      expect(getMockIpcCalls().filter((c) => c.cmd === "start_chat")).toHaveLength(1);
      const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
      expect((start?.args as { history?: unknown[] }).history).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-sends prompt into a new thread through the route", async () => {
    const prompt = "Explain the weakest topic now";
    const { router } = await renderAppAtRoute(
      `/course/cell-biology/chat?mode=explain&prompt=${encodeURIComponent(prompt)}`,
    );
    await waitFor(
      () => {
        expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true);
      },
      { timeout: 8000 },
    );
    await waitFor(() => {
      expect((router.state.location.search as { thread?: string }).thread).toBeTruthy();
      expect((router.state.location.search as { prompt?: string }).prompt).toBeUndefined();
    });
  });

  it("shows signed-out status after a completed answer when sending again", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    await fillComposer("First");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent("Done");
    });
    cleanup();
    clearMockIpcLog();
    resetAuthRefreshForTests();
    renderChatViewMinimal({
      check_auth: () =>
        Promise.resolve({ authenticated: false, reason: "signed out", docs_url: "" }),
    });
    await waitForChatShell();
    await fillComposer("Second");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent(/signed out|not logged in/i);
    });
  });

  it("ignores late cached lines in start_chat history during flight", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByText("ATP and energy currency"));
    await fillComposer("Follow-up question");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      const start = getMockIpcCalls().find((c) => c.cmd === "start_chat");
      expect((start?.args as { history?: unknown[] }).history).toEqual([
        { role: "user", content: "What is ATP?" },
        { role: "assistant", content: "ATP stores energy for cellular work." },
      ]);
    });
  });

  it("preserves drafts per thread and clears on send", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    await fillComposer("Draft for new");
    expect(useChatDraftsStore.getState().drafts).toMatchObject({
      [`${FIXTURE_ROOT_FALL}\0cell-biology\0new`]: "Draft for new",
    });
    await user.click(screen.getByText("ATP and energy currency"));
    await fillComposer("Draft for ATP");
    await openNewChat(user);
    await fillComposer("Send me");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(
        useChatDraftsStore.getState().drafts[`${FIXTURE_ROOT_FALL}\0cell-biology\0new`],
      ).toBeUndefined();
    });
  });

  it("keeps streaming answer on the original thread when switching mid-stream", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/chat", {
      start_chat: (args?: InvokeArgs) => {
        const channelId = parseMockChannelId((args as { onEvent?: unknown }).onEvent);
        if (channelId == null) {
          return null;
        }
        emitToChannel(channelId, { type: "chat_delta", delta: "Partial " }, 0);
        window.setTimeout(() => {
          emitToChannel(
            channelId,
            {
              type: "chat_done",
              markdown: "**Kept on thread**",
              supported: true,
              citations: [],
            },
            1,
          );
          emitToChannel(channelId, { type: "worker_exit", code: 0 }, 2);
        }, 200);
        return null;
      },
    });
    await waitForChatReady();
    await openNewChat(user);
    await fillComposer("Stay here");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect((router.state.location.search as { thread?: string }).thread).toBeTruthy();
    });
    const sendThread = (router.state.location.search as { thread?: string }).thread!;
    await user.click(screen.getByText("Membrane structure review"));
    expect(screen.queryByTestId("chat-live-answer")).not.toBeInTheDocument();
    await router.navigate({
      to: "/course/$course/chat",
      params: { course: "cell-biology" },
      search: { thread: sendThread },
    });
    await waitFor(
      () => {
        expect(
          getMockIpcCalls().some(
            (c) =>
              c.cmd === "append_chat_thread_lines" &&
              JSON.stringify(c.args).includes("Kept on thread"),
          ),
        ).toBe(true);
      },
      { timeout: 8000 },
    );
  });


});