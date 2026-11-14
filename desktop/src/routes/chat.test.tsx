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
  fixtureCourses,
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
import { classScopeKey, useLectureSelectionStore } from "~/stores/lecture-selection-store";
import { useSelectionStore } from "~/stores/selection-store";
import { useUiStore } from "~/stores/ui-store";
import { qk } from "~/lib/queries/keys";
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
  "onSearchClear" | "onModeSearchClear" | "onThreadChange"
> {
  return {
    onSearchClear: () => undefined,
    onModeSearchClear: () => undefined,
    onThreadChange: () => undefined,
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
      digests={fixtureDigests}
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
          digests={fixtureDigests}
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
              digests={fixtureDigests}
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
      expect(router.state.location.pathname).toBe("/course/cell-biology/read/2026-09-12-membranes");
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
      expect(router.state.location.pathname).toBe("/course/cell-biology/overview");
      expect(router.state.location.searchStr).toContain("heading=Overview");
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
        digests={[]}
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
            digests={fixtureDigests}
            threadId={null}
            {...noopThreadHandlers()}
          />
        </Profiler>,
        { minimal: true },
      );
      await waitForChatShell();
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

  it("an explain-weakest link auto-sends once the chat is ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const prompt = encodeURIComponent(
        'Explain the weakest topic "Cytoskeleton". Stay inside this course and cite sources.',
      );
      await renderAppAtRoute(`/course/cell-biology/chat?mode=explain&prompt=${prompt}`);
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

  it("Escape dismisses slash suggestions without clearing the draft", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    const view = screen.getByTestId("chat-view");
    const textarea = within(view).getByLabelText("Chat message");
    await user.click(textarea);
    await fillComposer("/explain");
    await waitFor(() => {
      expect(within(view).getByRole("listbox", { name: "Slash commands" })).toBeInTheDocument();
    });
    fireEvent.keyDown(textarea, { key: "Escape", code: "Escape" });
    await waitFor(() => {
      expect(within(view).queryByRole("listbox", { name: "Slash commands" })).not.toBeInTheDocument();
    });
    expect(textarea).toHaveValue("/explain");
  });

  it("Shift+Enter with slash list open inserts a newline instead of picking", async () => {
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
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, code: "Enter" });
    fireEvent.change(textarea, { target: { value: "/e\n" } });
    expect(textarea).toHaveValue("/e\n");
    expect(textarea).not.toHaveValue("/explain ");
  });

  it("mousedown on a slash suggestion inserts the command", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    const view = screen.getByTestId("chat-view");
    const textarea = within(view).getByLabelText("Chat message");
    await user.click(textarea);
    await fillComposer("/e");
    const listbox = await within(view).findByRole("listbox", { name: "Slash commands" });
    const explainOption = within(listbox).getByText("/explain").closest("li");
    expect(explainOption).not.toBeNull();
    fireEvent.mouseDown(explainOption!, { button: 0 });
    await waitFor(() => {
      expect(textarea).toHaveValue("/explain ");
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);
  });

  it("hides dictation on Linux and invokes start_dictation on Mac", async () => {
    const platformSpy = vi.spyOn(window.navigator, "platform", "get");
    platformSpy.mockReturnValue("Linux x86_64");
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    expect(
      within(screen.getByTestId("chat-view")).queryByRole("button", {
        name: "Dictate",
      }),
    ).not.toBeInTheDocument();

    cleanup();
    clearTauriMocks();
    clearMockIpcLog();
    resetAuthRefreshForTests();
    resetChatDraftsStoreForTests();

    platformSpy.mockReturnValue("MacIntel");
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(
      within(screen.getByTestId("chat-view")).getByRole("button", {
        name: "Dictate",
      }),
    );
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "start_dictation")).toBe(true);
    });
    platformSpy.mockRestore();
  });

  it("dictation locks the composer while listening and Escape cancels", async () => {
    const platformSpy = vi.spyOn(window.navigator, "platform", "get");
    platformSpy.mockReturnValue("MacIntel");
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    const view = screen.getByTestId("chat-view");
    const textarea = within(view).getByRole("textbox", { name: "Chat message" });
    await user.type(textarea, "Explain");
    await user.click(within(view).getByRole("button", { name: "Dictate" }));
    await waitFor(() =>
      expect(getMockIpcCalls().some((c) => c.cmd === "start_dictation")).toBe(true),
    );
    const channelId = parseMockChannelId(
      (getMockIpcCalls().find((c) => c.cmd === "start_dictation")?.args as { onEvent?: unknown })
        ?.onEvent,
    );
    act(() => {
      emitToChannel(channelId!, { kind: "listening" }, 0);
    });
    await waitFor(() =>
      expect(within(view).getByRole("button", { name: "Stop dictation" })).toBeInTheDocument(),
    );
    expect(textarea).toHaveAttribute("readonly");
    expect(within(view).getByRole("button", { name: "Send" })).toBeDisabled();

    act(() => {
      emitToChannel(channelId!, { kind: "partial", text: "recur" }, 1);
    });
    await waitFor(() => expect(textarea).toHaveValue("Explain recur"));

    fireEvent.keyDown(textarea, { key: "Escape" });
    await waitFor(() =>
      expect(getMockIpcCalls().some((c) => c.cmd === "cancel_dictation")).toBe(true),
    );
    await waitFor(() => expect(textarea).toHaveValue("Explain"));
    expect(within(view).getByRole("button", { name: "Dictate" })).toBeInTheDocument();
    platformSpy.mockRestore();
  });

  it("does not send on Enter while dictation is listening", async () => {
    const platformSpy = vi.spyOn(window.navigator, "platform", "get");
    platformSpy.mockReturnValue("MacIntel");
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    const view = screen.getByTestId("chat-view");
    const textarea = within(view).getByRole("textbox", { name: "Chat message" });
    await user.type(textarea, "Question");
    await user.click(within(view).getByRole("button", { name: "Dictate" }));
    await waitFor(() =>
      expect(getMockIpcCalls().some((c) => c.cmd === "start_dictation")).toBe(true),
    );
    const channelId = parseMockChannelId(
      (getMockIpcCalls().find((c) => c.cmd === "start_dictation")?.args as { onEvent?: unknown })
        ?.onEvent,
    );
    act(() => {
      emitToChannel(channelId!, { kind: "listening" }, 0);
    });
    await waitFor(() =>
      expect(within(view).getByRole("button", { name: "Stop dictation" })).toBeInTheDocument(),
    );
    clearMockIpcLog();
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(false);
    platformSpy.mockRestore();
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
                  digests={fixtureDigests}
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

describe("Ask in the class workspace", { timeout: 30000 }, () => {
  const ASK = "/course/cell-biology/ask";
  const SCOPE_KEY = classScopeKey(FIXTURE_ROOT_FALL, "cell-biology");
  const MEMBRANES = "cell-biology/digests/2026-09-12-membranes.md";
  const MITO = "cell-biology/digests/2026-09-15-mitochondria.md";

  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    resetChatLiveStoreForTests();
    resetChatDraftsStoreForTests();
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({ chatThreadsOpen: true, lastCourse: null });
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
    });
    useLectureSelectionStore.setState({ byClass: {} });
    useSelectionStore.getState().clearSelection();
    clearMockIpcLog();
    resetMockChatHistoryForTests();
  });

  afterEach(() => {
    cleanup();
    resetMockHandlerTimers();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  const startChatArgs = () =>
    getMockIpcCalls().find((c) => c.cmd === "start_chat")?.args as Record<string, unknown> | undefined;

  async function sendFromNewChat(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await fillComposer(text);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(startChatArgs()).toBeDefined());
  }

  it("sends the ticked lectures as digests, and no digests when none are ticked", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MEMBRANES, MITO]);
    const first = await renderAppAtRoute(ASK);
    await waitForChatReady();
    await sendFromNewChat(user, "What is a bilayer?");
    expect(startChatArgs()?.digests).toEqual([MEMBRANES, MITO]);
    expect(startChatArgs()).not.toHaveProperty("focus");
    first.unmount();

    clearMockIpcLog();
    resetChatLiveStoreForTests();
    useLectureSelectionStore.setState({ byClass: {} });
    await renderAppAtRoute(ASK);
    await waitForChatReady();
    await sendFromNewChat(user, "And without a scope?");
    expect(startChatArgs()).not.toHaveProperty("digests");
  });

  it("ignores ticked lectures that are not lectures of the class", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MEMBRANES, "cell-biology/digests/gone.md"]);
    await renderAppAtRoute(ASK);
    await waitForChatReady();
    await sendFromNewChat(user, "Scope check");
    expect(startChatArgs()?.digests).toEqual([MEMBRANES]);
  });

  it("Ask about this sends the focus once, then clears it from the selection store", async () => {
    const user = userEvent.setup();
    const focus = { digest: MEMBRANES, heading: "Membrane structure", text: "Phospholipid bilayer." };
    useSelectionStore.getState().setAskFocus(focus);
    await renderAppAtRoute(ASK);
    await waitForChatReady();
    expect(useSelectionStore.getState().askFocus).toBeNull();
    await sendFromNewChat(user, "Explain this passage");
    expect(startChatArgs()?.focus).toEqual(focus);
    await waitFor(() => expect(screen.getByTestId("chat-status")).toHaveTextContent("Done"));

    clearMockIpcLog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
    await fillComposer("A follow-up");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(startChatArgs()).toBeDefined());
    expect(startChatArgs()).not.toHaveProperty("focus");
  });

  it("drops an Ask about this focus that belongs to another class", async () => {
    const user = userEvent.setup();
    useSelectionStore.getState().setAskFocus({
      digest: "organic-chemistry-ii/digests/2026-09-12-sn2.md",
      heading: null,
      text: "Backside attack.",
    });
    await renderAppAtRoute(ASK);
    await waitForChatReady();
    expect(useSelectionStore.getState().askFocus).toBeNull();
    await sendFromNewChat(user, "Unrelated");
    expect(startChatArgs()).not.toHaveProperty("focus");
  });

  it("keeps the class title whole in the Ask header: the title does not shrink", async () => {
    await renderAppAtRoute(ASK);
    await waitForChatShell();
    const title = await screen.findByRole("heading", { level: 1, name: "Cell Biology" });
    expect(title).toHaveClass("shrink-0", "truncate");
    expect(title).not.toHaveClass("min-w-0");
  });

  it("Ask about this starts a new chat instead of opening the newest one", async () => {
    const user = userEvent.setup();
    const focus = { digest: MEMBRANES, heading: "Membrane structure", text: "Phospholipid bilayer." };
    useSelectionStore.getState().setAskFocus(focus);
    const { router } = await renderAppAtRoute(ASK);
    await waitForChatReady();
    expect(await screen.findByTestId("chat-focus")).toBeInTheDocument();
    // Give the chats list time to load: the newest chat must not be auto-selected.
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete all chats" })).toBeEnabled());
    expect((router.state.location.search as Record<string, unknown>).thread).toBeUndefined();
    await fillComposer("Explain this passage");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(startChatArgs()).toBeDefined());
    expect(startChatArgs()?.focus).toEqual(focus);
    expect(startChatArgs()?.history).toEqual([]);
  });

  it("Ask about these (lectures ticked on entry) starts a new chat instead of opening the newest one", async () => {
    const user = userEvent.setup();
    useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MEMBRANES, MITO]);
    const { router } = await renderAppAtRoute(ASK);
    await waitForChatReady();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete all chats" })).toBeEnabled());
    expect((router.state.location.search as Record<string, unknown>).thread).toBeUndefined();
    await fillComposer("What do these have in common?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(startChatArgs()).toBeDefined());
    expect(startChatArgs()?.digests).toEqual([MEMBRANES, MITO]);
    expect(startChatArgs()?.history).toEqual([]);
  });

  it("drops an unsent Ask about this focus when the active library changes to one with a same-named class", async () => {
    const sharedCourses = fixtureCourses[FIXTURE_ROOT_SHARED]!;
    fixtureCourses[FIXTURE_ROOT_SHARED] = [...sharedCourses, "cell-biology"];
    try {
      useSelectionStore.getState().setAskFocus({
        digest: MEMBRANES,
        heading: "Membrane structure",
        text: "Phospholipid bilayer.",
      });
      const { queryClient, router } = await renderAppAtRoute(ASK);
      expect(await screen.findByTestId("chat-focus")).toBeInTheDocument();
      const settings = queryClient.getQueryData<typeof fixtureSettings>(qk.settings())!;
      act(() => {
        queryClient.setQueryData(qk.settings(), { ...settings, active_root: FIXTURE_ROOT_SHARED });
      });
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Chat message" })).toBeEnabled());
      expect(router.state.location.pathname).toBe(ASK);
      expect(screen.queryByTestId("chat-focus")).not.toBeInTheDocument();
    } finally {
      fixtureCourses[FIXTURE_ROOT_SHARED] = sharedCourses;
    }
  });

  describe("answers", () => {
    const seedAnswer = (citations: Array<{ digest_path: string; heading_id?: string }>) =>
      seedMockChatHistory(FIXTURE_ROOT_FALL, "cell-biology", [
        buildUserLine("ask", "Why does it saturate?"),
        buildAssistantLine("ask", "Carriers saturate at **Vmax**.", true, citations),
      ]);

    it("shows Sources and the Make cards, Quiz me and Copy actions", async () => {
      seedAnswer([{ digest_path: MEMBRANES, heading_id: "Membrane structure" }]);
      await renderAppAtRoute(ASK);
      await waitForChatShell();
      expect(await screen.findByText("Sources")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Make cards from this" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Quiz me on this" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    });

    it("names each source by its lecture title and heading in an outlined info chip", async () => {
      seedAnswer([
        { digest_path: MEMBRANES, heading_id: "Membrane structure" },
        { digest_path: "cell-biology/digests/2026-10-01-ion-channels.md", heading_id: "Gating" },
      ]);
      await renderAppAtRoute(ASK);
      const listed = await screen.findByRole("button", { name: "Cell membranes · Membrane structure" });
      expect(listed).toHaveClass("border-info", "text-info");
      // A lecture the list does not know is named from its file name, never the raw file name.
      expect(screen.getByRole("button", { name: "Ion channels · Gating" })).toBeInTheDocument();
      expect(screen.queryByText(/\.md/)).not.toBeInTheDocument();
    });

    it("Make cards from this starts a flashcard job from the answer text over its cited lectures", async () => {
      const user = userEvent.setup();
      seedAnswer([
        { digest_path: MEMBRANES, heading_id: "Membrane structure" },
        { digest_path: "cell-biology/course.md", heading_id: "Overview" },
      ]);
      await renderAppAtRoute(ASK);
      await user.click(await screen.findByRole("button", { name: "Make cards from this" }));
      await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"), { timeout: 5000 });
      const args = getMockIpcCalls().find((c) => c.cmd === "start_study_job")?.args as Record<string, unknown>;
      expect(args).toMatchObject({
        course: "cell-biology",
        skill: "flashcards",
        fromText: "Carriers saturate at **Vmax**.",
        digests: [MEMBRANES],
      });
    });

    it("Quiz me on this starts a quiz job, falling back to the ticked lectures when nothing is cited", async () => {
      const user = userEvent.setup();
      useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MITO]);
      seedAnswer([]);
      await renderAppAtRoute(ASK);
      // Ticked lectures open Ask on a new chat: open the seeded one from the Chats list.
      await user.click(await screen.findByRole("button", { name: /Why does it saturate/ }));
      await user.click(await screen.findByRole("button", { name: "Quiz me on this" }));
      await waitFor(() => expect(getMockIpcLog()).toContain("start_study_job"), { timeout: 5000 });
      const args = getMockIpcCalls().find((c) => c.cmd === "start_study_job")?.args as Record<string, unknown>;
      expect(args).toMatchObject({ skill: "quiz", fromText: "Carriers saturate at **Vmax**.", digests: [MITO] });
    });

    it("cannot make cards from an answer with no lecture to anchor them", async () => {
      seedAnswer([]);
      await renderAppAtRoute(ASK);
      expect(await screen.findByRole("button", { name: "Make cards from this" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Quiz me on this" })).toBeDisabled();
    });

    it("Copy puts the answer on the clipboard", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      seedAnswer([{ digest_path: MEMBRANES }]);
      await renderAppAtRoute(ASK);
      const button = await screen.findByRole("button", { name: "Copy" });
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await user.click(button);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("Carriers saturate at **Vmax**."));
    });

    it("a lecture source opens that lecture in Read at its heading", async () => {
      const user = userEvent.setup();
      seedAnswer([{ digest_path: MEMBRANES, heading_id: "Membrane structure" }]);
      const { router } = await renderAppAtRoute(ASK);
      await user.click(await screen.findByRole("button", { name: /Cell membranes · Membrane structure/ }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/course/cell-biology/read/2026-09-12-membranes");
        expect(router.state.location.searchStr).toContain("heading=Membrane+structure");
      });
    });

    it("the Course overview source opens the Overview at the cited heading, or Course notes", async () => {
      const user = userEvent.setup();
      seedAnswer([{ digest_path: "cell-biology/course.md", heading_id: "Exam format" }]);
      const first = await renderAppAtRoute(ASK);
      await user.click(await screen.findByRole("button", { name: /Course overview · Exam format/ }));
      await waitFor(() => {
        expect(first.router.state.location.pathname).toBe("/course/cell-biology/overview");
        expect(first.router.state.location.searchStr).toContain("heading=Exam+format");
      });
      first.unmount();

      seedAnswer([{ digest_path: "cell-biology/course.md" }]);
      const second = await renderAppAtRoute(ASK);
      await user.click(await screen.findByRole("button", { name: /Course overview/ }));
      await waitFor(() => {
        expect(second.router.state.location.pathname).toBe("/course/cell-biology/overview");
        expect(second.router.state.location.searchStr).toContain("heading=Course+notes");
      });
    });
  });

  describe("layout", () => {
    it("the Chats list replaces the lecture column, beside the class header with its Course select", async () => {
      await renderAppAtRoute(ASK);
      await waitForChatReady();
      expect(screen.queryByRole("navigation", { name: "Lectures" })).not.toBeInTheDocument();
      const chats = screen.getByRole("navigation", { name: "Chat threads" });
      expect(within(chats).getByText("Chats")).toBeInTheDocument();
      expect(within(chats).getByRole("button", { name: "New chat" })).toHaveTextContent("New");
      expect(within(chats).getByRole("button", { name: "Hide chats" })).toHaveTextContent("Hide");
      expect(within(chats).getByLabelText("Search chats")).toBeInTheDocument();
      expect(within(chats).getByRole("button", { name: "Delete all chats" })).toBeInTheDocument();
      const header = screen.getByRole("heading", { name: "Cell Biology", level: 1 });
      expect(chats.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(chats.contains(header)).toBe(false);
      // The header sits in the pane beside the Chats list, not above it.
      expect(chats.parentElement?.contains(header)).toBe(true);
      expect(within(screen.getByTestId("workspace-main")).getByRole("combobox", { name: "Course" })).toBeInTheDocument();
    });

    it("groups the chats by day", async () => {
      const now = new Date().toISOString();
      const long = "2026-01-05T10:00:00.000Z";
      seedMockChatThread(FIXTURE_ROOT_FALL, "cell-biology", { id: "t-new", title: "Fresh question", mode: "explain", created_at: now, updated_at: now }, []);
      seedMockChatThread(FIXTURE_ROOT_FALL, "cell-biology", { id: "t-old", title: "Ancient question", mode: "ask", created_at: long, updated_at: long }, []);
      await renderAppAtRoute(ASK);
      await waitForChatShell();
      const chats = await screen.findByRole("navigation", { name: "Chat threads" });
      await within(chats).findByText("Fresh question");
      expect(within(chats).getByText("Today")).toBeInTheDocument();
      expect(within(chats).getByText("Earlier")).toBeInTheDocument();
      expect(within(chats).getByText("Explain · now")).toBeInTheDocument();
    });

    it("Hide closes the Chats list and the header's Show chats brings it back", async () => {
      const user = userEvent.setup();
      await renderAppAtRoute(ASK);
      await waitForChatReady();
      await user.click(screen.getByRole("button", { name: "Hide chats" }));
      expect(screen.queryByRole("navigation", { name: "Chat threads" })).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Lectures" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Show chats" }));
      expect(await screen.findByRole("navigation", { name: "Chat threads" })).toBeInTheDocument();
    });

    it("the Course select opens Ask for that class", async () => {
      const user = userEvent.setup();
      const { router } = await renderAppAtRoute(ASK);
      await waitForChatShell();
      await user.click(await screen.findByRole("combobox", { name: "Course" }));
      await user.click(await screen.findByRole("option", { name: "Organic Chemistry II" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/ask"));
    });

    it("says what the answers are scoped to while lectures are ticked, and × clears it", async () => {
      const user = userEvent.setup();
      useLectureSelectionStore.getState().setScope(SCOPE_KEY, [MEMBRANES, MITO]);
      await renderAppAtRoute(ASK);
      await waitForChatShell();
      // The newest chat opens once the chats load, which remounts the view: wait for it.
      await waitForChatReady();
      await user.click(await screen.findByRole("button", { name: /Stop asking about 2 lectures/ }));
      await waitFor(() => expect(useLectureSelectionStore.getState().byClass[SCOPE_KEY]).toBeUndefined());
      expect(screen.queryByRole("button", { name: /Stop asking about/ })).not.toBeInTheDocument();
    });
  });
});
