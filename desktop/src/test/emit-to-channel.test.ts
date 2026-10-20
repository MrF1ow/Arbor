import { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";

describe("emitToChannel", () => {
  afterEach(() => {
    clearMocks();
  });

  it("dispatches messages to a Channel via mock runCallback", () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const onmessage = vi.fn();
    const channel = new Channel(onmessage);
    const channelId = parseMockChannelId(channel);
    expect(channelId).not.toBeNull();

    emitToChannel(channelId!, { type: "chat_delta", delta: "Hi" }, 0);
    expect(onmessage).toHaveBeenCalledWith({ type: "chat_delta", delta: "Hi" });

    emitToChannel(channelId!, { type: "chat_done", markdown: "Done" }, 1);
    expect(onmessage).toHaveBeenCalledWith({ type: "chat_done", markdown: "Done" });
  });

  it("parseMockChannelId reads serialized channel strings", () => {
    expect(parseMockChannelId("__CHANNEL__:42")).toBe(42);
    expect(parseMockChannelId("__CHANNEL__:x")).toBeNull();
    expect(parseMockChannelId({ id: 7 })).toBe(7);
  });
});
