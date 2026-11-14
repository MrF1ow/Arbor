import { describe, expect, it, vi } from "vitest";

import { chatAuthErrorMessage } from "~/domain/chat";

describe("chatAuthErrorMessage", () => {
  it("maps plain timeout errors for the runner status line", () => {
    expect(chatAuthErrorMessage("Grok", new Error("timeout"))).toContain("timeout");
  });
});

describe("sendChatMessage scope", () => {
  const base = {
    root: "/mock/knowledge/fall-2026",
    course: "cell-biology",
    threadId: null,
    mode: "ask" as const,
    question: "Why does osmosis stall?",
    providerId: "grok",
    providerLabel: "Grok",
    modelId: "grok-4.7",
    history: [],
  };

  async function startChatArgs(scope: Record<string, unknown>) {
    const { createAppQueryClient } = await import("~/lib/query-client");
    const { installMockIpc, clearTauriMocks } = await import("~/test/mock-ipc");
    const { getMockIpcCalls, clearMockIpcLog, resetMockHandlerTimers } = await import(
      "~/test/mock-handlers"
    );
    const { sendChatMessage } = await import("~/lib/chat-runner");
    clearTauriMocks();
    installMockIpc();
    clearMockIpcLog();
    await sendChatMessage({ ...base, queryClient: createAppQueryClient(), ...scope });
    await vi.waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "start_chat")).toBe(true);
    });
    const call = getMockIpcCalls().find((c) => c.cmd === "start_chat")!;
    resetMockHandlerTimers();
    clearTauriMocks();
    return call.args as Record<string, unknown>;
  }

  it("sends the ticked lectures as digests", async () => {
    const args = await startChatArgs({
      digests: ["cell-biology/digests/2026-09-12-membranes.md"],
    });
    expect(args.digests).toEqual(["cell-biology/digests/2026-09-12-membranes.md"]);
    expect(args).not.toHaveProperty("focus");
  });

  it("sends a focused passage as focus", async () => {
    const focus = {
      digest: "cell-biology/digests/2026-09-12-membranes.md",
      heading: "Membrane structure",
      text: "Phospholipid bilayer",
    };
    const args = await startChatArgs({ focus });
    expect(args.focus).toEqual(focus);
  });

  it("sends neither key when the chat is unscoped", async () => {
    const args = await startChatArgs({});
    expect(args).not.toHaveProperty("digests");
    expect(args).not.toHaveProperty("focus");
  });
});
