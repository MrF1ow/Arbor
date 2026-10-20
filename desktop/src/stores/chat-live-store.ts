const liveByKey = new Map<string, string>();
const listeners = new Set<() => void>();

export function chatLiveKey(root: string, course: string): string {
  return `${root}\0${course}`;
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeChatLive(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getChatLiveText(key: string): string {
  return liveByKey.get(key) ?? "";
}

export function appendChatLiveDelta(key: string, delta: string) {
  liveByKey.set(key, (liveByKey.get(key) ?? "") + delta);
  emitChange();
}

export function clearChatLive(key: string) {
  if (liveByKey.delete(key)) {
    emitChange();
  }
}

export function resetChatLiveStoreForTests() {
  liveByKey.clear();
  emitChange();
}
