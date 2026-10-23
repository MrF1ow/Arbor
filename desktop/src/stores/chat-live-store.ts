export type ChatLiveStatusTone = "destructive" | "muted";

export type ChatLiveSnapshot = {
  text: string;
  statusText: string;
  statusTone: ChatLiveStatusTone;
  inFlight: boolean;
};

export const EMPTY_CHAT_LIVE_SNAPSHOT: ChatLiveSnapshot = {
  text: "",
  statusText: "",
  statusTone: "muted",
  inFlight: false,
};

const liveByKey = new Map<string, ChatLiveSnapshot>();
const listeners = new Set<() => void>();

export function chatLiveKey(root: string, course: string, threadId: string): string {
  return `${root}\0${course}\0${threadId}`;
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function snapshotFor(key: string): ChatLiveSnapshot {
  return liveByKey.get(key) ?? EMPTY_CHAT_LIVE_SNAPSHOT;
}

function setSnapshot(key: string, next: ChatLiveSnapshot) {
  liveByKey.set(key, next);
  emitChange();
}

export function subscribeChatLive(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getChatLiveSnapshot(key: string): ChatLiveSnapshot {
  return snapshotFor(key);
}

export function getChatLiveText(key: string): string {
  return snapshotFor(key).text;
}

export function isChatLiveInFlight(key: string): boolean {
  return snapshotFor(key).inFlight;
}

export function beginChatLiveStream(key: string) {
  const prev = snapshotFor(key);
  setSnapshot(key, {
    ...prev,
    text: "",
    inFlight: true,
  });
}

export function appendChatLiveDelta(key: string, delta: string) {
  const prev = snapshotFor(key);
  setSnapshot(key, {
    ...prev,
    text: prev.text + delta,
  });
}

export function clearChatLiveText(key: string) {
  const prev = snapshotFor(key);
  if (prev.text === "") {
    return;
  }
  setSnapshot(key, {
    ...prev,
    text: "",
  });
}

export function setChatLiveStatus(
  key: string,
  statusText: string,
  statusTone: ChatLiveStatusTone,
) {
  const prev = snapshotFor(key);
  setSnapshot(key, {
    ...prev,
    statusText,
    statusTone,
  });
}

export function finishChatLiveStream(key: string) {
  const prev = snapshotFor(key);
  setSnapshot(key, {
    ...prev,
    text: "",
    inFlight: false,
  });
}

export function clearChatLive(key: string) {
  if (liveByKey.delete(key)) {
    emitChange();
  }
}

export function clearChatLiveIfIdle(key: string) {
  if (snapshotFor(key).inFlight) {
    return;
  }
  clearChatLive(key);
}

export function resetChatLiveStoreForTests() {
  liveByKey.clear();
  emitChange();
}
