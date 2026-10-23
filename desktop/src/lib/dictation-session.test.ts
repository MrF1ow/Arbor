import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { spliceDictation, useDictation } from "~/lib/dictation";
import { clearMockIpcLog, getMockIpcCalls } from "~/test/mock-handlers";
import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";
import { installMockIpc } from "~/test/mock-ipc";

beforeEach(() => {
  installMockIpc();
});

describe("spliceDictation", () => {
  const cases: Array<{
    text: string;
    selStart: number;
    selEnd: number;
    spoken: string;
    out: string;
    caret: number;
  }> = [
    { text: "", selStart: 0, selEnd: 0, spoken: "hello world", out: "hello world", caret: 11 },
    { text: "Explain", selStart: 7, selEnd: 7, spoken: "recursion", out: "Explain recursion", caret: 17 },
    { text: "Explain ", selStart: 8, selEnd: 8, spoken: "recursion", out: "Explain recursion", caret: 17 },
    {
      text: "Explain please",
      selStart: 8,
      selEnd: 8,
      spoken: "recursion",
      out: "Explain recursion please",
      caret: 17,
    },
    {
      text: "Explain this please",
      selStart: 8,
      selEnd: 12,
      spoken: "recursion",
      out: "Explain recursion please",
      caret: 17,
    },
    { text: "Hi", selStart: 2, selEnd: 2, spoken: "  ", out: "Hi", caret: 2 },
  ];

  it.each(cases)("splices %#", ({ text, selStart, selEnd, spoken, out, caret }) => {
    expect(
      spliceDictation({ text, selectionStart: selStart, selectionEnd: selEnd }, spoken),
    ).toEqual({ text: out, caret });
  });
});

describe("useDictation", () => {
  afterEach(() => {
    clearMockIpcLog();
    vi.restoreAllMocks();
  });

  it("updates draft on partials and applies final with idle phase", async () => {
    const onDraft = vi.fn();
    const onApplyFinal = vi.fn();
    const { result } = renderHook(() => useDictation({ onDraft, onApplyFinal }));

    await act(async () => {
      void result.current.start({ text: "Explain", selectionStart: 7, selectionEnd: 7 });
    });

    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "start_dictation")).toBe(true);
    });

    const call = getMockIpcCalls().find((c) => c.cmd === "start_dictation");
    const channelId = parseMockChannelId((call?.args as { onEvent?: unknown })?.onEvent);
    expect(channelId).not.toBeNull();

    act(() => {
      emitToChannel(channelId!, { kind: "listening" }, 0);
    });
    await waitFor(() => expect(result.current.phase).toBe("listening"));

    act(() => {
      emitToChannel(channelId!, { kind: "partial", text: "recur" }, 1);
    });
    expect(onDraft).toHaveBeenCalledWith("Explain recur");

    act(() => {
      emitToChannel(channelId!, { kind: "final", text: "recursion" }, 2);
    });
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(onApplyFinal).toHaveBeenCalledWith("Explain recursion", 17);
  });

  it("cancel restores base draft", async () => {
    const onDraft = vi.fn();
    const onApplyFinal = vi.fn();
    const { result } = renderHook(() => useDictation({ onDraft, onApplyFinal }));

    await act(async () => {
      void result.current.start({ text: "Keep me", selectionStart: 0, selectionEnd: 0 });
    });
    await waitFor(() => expect(getMockIpcCalls().some((c) => c.cmd === "start_dictation")).toBe(true));

    act(() => {
      result.current.cancel();
    });
    expect(onDraft).toHaveBeenLastCalledWith("Keep me");
    expect(getMockIpcCalls().some((c) => c.cmd === "cancel_dictation")).toBe(true);
    expect(result.current.phase).toBe("idle");
  });

  it("error restores draft and toasts with settings action for denied codes", async () => {
    const toastSpy = vi.spyOn(toast, "error");
    const onDraft = vi.fn();
    const onApplyFinal = vi.fn();
    const { result } = renderHook(() => useDictation({ onDraft, onApplyFinal }));

    await act(async () => {
      void result.current.start({ text: "Original", selectionStart: 0, selectionEnd: 0 });
    });
    await waitFor(() => expect(getMockIpcCalls().some((c) => c.cmd === "start_dictation")).toBe(true));
    const channelId = parseMockChannelId(
      (getMockIpcCalls().find((c) => c.cmd === "start_dictation")?.args as { onEvent?: unknown })
        ?.onEvent,
    );

    act(() => {
      emitToChannel(
        channelId!,
        {
          kind: "error",
          code: "speech_denied",
          message: "Speech denied",
        },
        0,
      );
    });

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(onDraft).toHaveBeenLastCalledWith("Original");
    expect(toastSpy).toHaveBeenCalledWith(
      "Speech denied",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Open Settings" }),
      }),
    );
  });

  it("ignores stale session events after cancel and restart", async () => {
    const onDraft = vi.fn();
    const onApplyFinal = vi.fn();
    const { result } = renderHook(() => useDictation({ onDraft, onApplyFinal }));

    await act(async () => {
      void result.current.start({ text: "First", selectionStart: 0, selectionEnd: 0 });
    });
    await waitFor(() => expect(getMockIpcCalls().some((c) => c.cmd === "start_dictation")).toBe(true));
    const firstChannel = parseMockChannelId(
      (getMockIpcCalls().find((c) => c.cmd === "start_dictation")?.args as { onEvent?: unknown })
        ?.onEvent,
    );

    act(() => {
      result.current.cancel();
    });

    onDraft.mockClear();
    await act(async () => {
      void result.current.start({ text: "Second", selectionStart: 0, selectionEnd: 0 });
    });
    await waitFor(() => expect(getMockIpcCalls().filter((c) => c.cmd === "start_dictation").length).toBe(2));

    act(() => {
      emitToChannel(firstChannel!, { kind: "partial", text: "stale" }, 0);
    });
    expect(onDraft).not.toHaveBeenCalledWith(expect.stringContaining("stale"));
    expect(onApplyFinal).not.toHaveBeenCalled();
  });
});
