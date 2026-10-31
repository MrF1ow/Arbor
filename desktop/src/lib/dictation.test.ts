import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDictation, showDictationError, spliceDictation } from "~/lib/dictation";
import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { clearTauriMocks, installMockIpc } from "~/test/mock-ipc";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn((_message: string, opts?: { action?: { onClick?: () => void } }) => {
      (toast.error as ReturnType<typeof vi.fn> & { lastAction?: () => void }).lastAction =
        opts?.action?.onClick;
    }),
  },
}));

import { toast } from "sonner";

describe("spliceDictation", () => {
  it("inserts spoken text at the selection", () => {
    expect(
      spliceDictation(
        { text: "Hello world", selectionStart: 5, selectionEnd: 5 },
        "there",
      ).text,
    ).toBe("Hello there world");
  });
});

describe("useDictation", () => {
  beforeEach(() => {
    clearTauriMocks();
    installMockIpc();
    clearMockIpcLog();
  });

  it("ignores late partial after final closed the session", async () => {
    const onDraft = vi.fn();
    const { result } = renderHook(() =>
      useDictation({ onDraft, onApplyFinal: vi.fn() }),
    );
    await act(async () => {
      void result.current.start({
        text: "Hi",
        selectionStart: 2,
        selectionEnd: 2,
      });
    });
    const channelId = parseMockChannelId(
      (getMockIpcCalls().find((c) => c.cmd === "start_dictation")?.args as { onEvent?: unknown })
        ?.onEvent,
    );
    act(() => {
      emitToChannel(channelId!, { kind: "listening" }, 0);
    });
    act(() => {
      emitToChannel(channelId!, { kind: "final", text: "done" }, 1);
    });
    onDraft.mockClear();
    act(() => {
      emitToChannel(channelId!, { kind: "partial", text: "late" }, 2);
    });
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("restores the base draft when start_dictation rejects", async () => {
    clearTauriMocks();
    installMockIpc({
      start_dictation: () => {
        throw new Error("Dictation is only available on macOS");
      },
    });
    clearMockIpcLog();
    const onDraft = vi.fn();
    const { result } = renderHook(() =>
      useDictation({ onDraft, onApplyFinal: vi.fn() }),
    );
    await act(async () => {
      await result.current.start({
        text: "Keep me",
        selectionStart: 0,
        selectionEnd: 0,
      });
    });
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith("Keep me"));
    expect(result.current.phase).toBe("idle");
  });

  it("writes partials to the draft writer captured at start after thread props change", async () => {
    const drafts: Record<string, string> = {};
    const { result, rerender } = renderHook(
      ({ thread }: { thread: string }) =>
        useDictation({
          onDraft: (text) => {
            drafts[thread] = text;
          },
          onApplyFinal: vi.fn(),
        }),
      { initialProps: { thread: "thread-a" } },
    );
    await act(async () => {
      void result.current.start({
        text: "Hello",
        selectionStart: 5,
        selectionEnd: 5,
      });
    });
    rerender({ thread: "thread-b" });
    const channelId = parseMockChannelId(
      (getMockIpcCalls().find((c) => c.cmd === "start_dictation")?.args as { onEvent?: unknown })
        ?.onEvent,
    );
    act(() => {
      emitToChannel(channelId!, { kind: "listening" }, 0);
      emitToChannel(channelId!, { kind: "partial", text: "world" }, 1);
    });
    await waitFor(() => expect(drafts["thread-a"]).toContain("world"));
    expect(drafts["thread-b"]).toBeUndefined();
  });
});

describe("showDictationError", () => {
  beforeEach(() => {
    clearTauriMocks();
    installMockIpc();
    clearMockIpcLog();
    vi.mocked(toast.error).mockClear();
  });

  it("Open Settings invokes open_privacy_settings for microphone_denied", () => {
    showDictationError("microphone_denied", "Need mic");
    const action = (toast.error as ReturnType<typeof vi.fn> & { lastAction?: () => void })
      .lastAction;
    expect(action).toBeDefined();
    act(() => {
      action!();
    });
    expect(getMockIpcCalls().some((c) => c.cmd === "open_privacy_settings")).toBe(true);
    const call = getMockIpcCalls().find((c) => c.cmd === "open_privacy_settings");
    expect((call?.args as { pane?: string }).pane).toBe("microphone");
  });

  it("Open Settings for dictation_disabled opens the Keyboard dictation pane", () => {
    showDictationError("dictation_disabled", "Turn dictation on");
    const action = (toast.error as ReturnType<typeof vi.fn> & { lastAction?: () => void })
      .lastAction;
    act(() => {
      action!();
    });
    const call = getMockIpcCalls().find((c) => c.cmd === "open_privacy_settings");
    expect((call?.args as { pane?: string }).pane).toBe("dictation");
  });
});
