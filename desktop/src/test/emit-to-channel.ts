type MockTauriInternals = {
  runCallback?: (id: number, payload: { index: number; message: unknown }) => void;
};

/** Deliver a Tauri {@link Channel} message when `@tauri-apps/api/mocks` is installed. */
export function emitToChannel(channelId: number, message: unknown, index: number) {
  const internals = (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: MockTauriInternals })
    .__TAURI_INTERNALS__;
  if (!internals?.runCallback) {
    throw new Error("Tauri mock runCallback is not available");
  }
  internals.runCallback(channelId, { index, message });
}

export function parseMockChannelId(onEvent: unknown): number | null {
  if (typeof onEvent === "string" && onEvent.startsWith("__CHANNEL__:")) {
    const id = Number(onEvent.slice("__CHANNEL__:".length));
    return Number.isNaN(id) ? null : id;
  }
  if (onEvent != null && typeof onEvent === "object" && "id" in onEvent) {
    const id = Number((onEvent as { id: number }).id);
    return Number.isNaN(id) ? null : id;
  }
  return null;
}
