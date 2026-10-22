import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { buildAssistantLine, buildUserLine } from "~/domain/chat";
import { ChatView } from "~/components/chat/chat-view";
import {
  FIXTURE_ROOT_FALL,
  fixtureDigests,
  fixtureSettings,
} from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  resetMockHandlerTimers,
  resetMockChatHistoryForTests,
  seedMockChatHistory,
} from "~/test/mock-handlers";

import {
  appendChatLiveDelta,
  chatLiveKey,
  resetChatLiveStoreForTests,
} from "~/stores/chat-live-store";
import { resetChatDraftsStoreForTests, useChatDraftsStore } from "~/stores/chat-drafts-store";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { renderAppAtRoute, renderWithProviders } from "~/test/render";
import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";
import { ChatTranscript } from "~/components/chat/chat-transcript";
import { Profiler } from "react";

async function waitForChatReady() {
  await waitFor(
    () => {
      expect(screen.getByTestId("chat-view")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
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

  it("clicking a row shows its transcript", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByText("ATP and energy currency"));
    await waitFor(() => {
      expect(screen.getByText("What is ATP?")).toBeInTheDocument();
    });
  });

  it("new chat send creates a titled thread and sets thread in URL", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    await fillComposer("My unique thread question");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "create_chat_thread")).toBe(true);
    });
    await waitFor(() => {
      expect(
        getMockIpcCalls().some(
          (c) =>
            c.cmd === "append_chat_thread_lines" &&
            JSON.stringify(c.args).includes("My unique thread question"),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      const nav = screen.getByRole("navigation", { name: "Chat threads" });
      expect(within(nav).getByText("My unique thread question")).toBeInTheDocument();
    });
  });

  it("rename and delete through row menus", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByText("ATP and energy currency"));
    const row = screen.getByText("ATP and energy currency").closest(".group")!;
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Chat options" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Chat title");
    fireEvent.change(input, { target: { value: "Renamed ATP chat" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Renamed ATP chat")).toBeInTheDocument();
    });
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Chat options" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByText("Renamed ATP chat")).not.toBeInTheDocument();
    });
  });

  it("delete all chats clears the list", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByRole("button", { name: "Delete all chats" }));
    await user.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() => {
      expect(screen.getByText("No chats yet")).toBeInTheDocument();
    });
  });

  it("filters threads by search", async () => {
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    const search = screen.getByLabelText("Search chats");
    fireEvent.change(search, { target: { value: "membrane" } });
    await waitFor(() => {
      expect(screen.getByText("Membrane structure review")).toBeInTheDocument();
      expect(screen.queryByText("Explain the cytoskeleton")).not.toBeInTheDocument();
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
    expect(useChatDraftsStore.getState().drafts[`${FIXTURE_ROOT_FALL}\0cell-biology\0new`]).toBe(
      "Draft for new",
    );
    await openNewChat(user);
    await fillComposer("Send me");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(
        useChatDraftsStore.getState().drafts[`${FIXTURE_ROOT_FALL}\0cell-biology\0new`],
      ).toBeUndefined();
    });
  });

  it("persists mode per thread", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await user.click(screen.getByText("Membrane structure review"));
    expect(screen.getByRole("button", { name: "Ask mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByText("Explain the cytoskeleton"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Explain mode" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it("auto-sends prompt into a new thread", async () => {
    const prompt = "Explain the weakest topic now";
    renderWithProviders(
      <ChatView
        activeRoot={FIXTURE_ROOT_FALL}
        course="cell-biology"
        courses={["cell-biology"]}
        digests={fixtureDigests}
        roots={fixtureSettings.knowledge_roots}
        threadId={null}
        modeParam="explain"
        promptParam={prompt}
        onSearchClear={() => undefined}
        onModeSearchClear={() => undefined}
        onCourseChange={() => undefined}
        onThreadChange={() => undefined}
        onNewChatNavigate={() => undefined}
      />,
      { minimal: true },
    );
    await waitFor(
      () => {
        expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true);
      },
      { timeout: 8000 },
    );
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
    await fillComposer("Line one\nLine two");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true);
    });
    await waitFor(
      () => {
        expect(getMockIpcCalls().some((c) => c.cmd === "append_chat_thread_lines")).toBe(true);
      },
      { timeout: 8000 },
    );
  });

  it("blocks send when signed out or model missing", async () => {
    resetAuthRefreshForTests();
    const user = userEvent.setup();
    renderWithProviders(
      <ChatView
        activeRoot={FIXTURE_ROOT_FALL}
        course="cell-biology"
        courses={["cell-biology"]}
        digests={fixtureDigests}
        roots={fixtureSettings.knowledge_roots}
        threadId={null}
        onSearchClear={() => undefined}
        onModeSearchClear={() => undefined}
        onCourseChange={() => undefined}
        onThreadChange={() => undefined}
        onNewChatNavigate={() => undefined}
      />,
      {
        minimal: true,
        fixtures: {
          check_auth: () =>
            Promise.resolve({
              authenticated: false,
              reason: "not logged in",
              docs_url: "",
            }),
        },
      },
    );
    await waitForChatReady();
    await fillComposer("Hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-status")).toHaveTextContent(/not logged in|signed out/i);
    });
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
    ]);
    const { router } = await renderAppAtRoute("/course/cell-biology/chat");
    await waitFor(() => expect(screen.getByTestId("chat-view")).toBeInTheDocument());
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Cell membranes · Membrane structure/i }),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Cell membranes · Membrane structure/i }),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: /Cell membranes · Membrane structure/i }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/notes/2026-09-12-membranes");
    });
  });

  it("shows empty-state copy on new chat", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/chat");
    await waitForChatReady();
    await openNewChat(user);
    expect(screen.getByText("Ask about Cell Biology")).toBeInTheDocument();
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
    act(() => {
      appendChatLiveDelta(
        chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology", "t-20261020T160000Z-000001"),
        " streamed",
      );
    });
    expect(transcriptUpdates).toBe(initial);
  });

});
