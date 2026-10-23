import { create } from "zustand";
import { persist } from "zustand/middleware";

function draftKey(root: string, course: string, threadId: string | null): string {
  return `${root}\0${course}\0${threadId ?? "new"}`;
}

interface ChatDraftsState {
  drafts: Record<string, string>;
  setDraft: (root: string, course: string, threadId: string | null, text: string) => void;
  clearDraft: (root: string, course: string, threadId: string | null) => void;
  moveDraft: (
    root: string,
    course: string,
    fromThreadId: string | null,
    toThreadId: string,
  ) => void;
}

export const useChatDraftsStore = create<ChatDraftsState>()(
  persist(
    (set, get) => ({
      drafts: {},
      setDraft: (root, course, threadId, text) => {
        const key = draftKey(root, course, threadId);
        set((state) => ({
          drafts: { ...state.drafts, [key]: text },
        }));
      },
      clearDraft: (root, course, threadId) => {
        const key = draftKey(root, course, threadId);
        set((state) => {
          if (!(key in state.drafts)) {
            return state;
          }
          const next = { ...state.drafts };
          delete next[key];
          return { drafts: next };
        });
      },
      moveDraft: (root, course, fromThreadId, toThreadId) => {
        const fromKey = draftKey(root, course, fromThreadId);
        const toKey = draftKey(root, course, toThreadId);
        const text = get().drafts[fromKey];
        if (text == null) {
          return;
        }
        set((state) => {
          const next = { ...state.drafts, [toKey]: text };
          delete next[fromKey];
          return { drafts: next };
        });
      },
    }),
    {
      name: "arbor.chat.drafts",
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);

export function chatDraftKey(root: string, course: string, threadId: string | null): string {
  return draftKey(root, course, threadId);
}

export function resetChatDraftsStoreForTests() {
  useChatDraftsStore.setState({ drafts: {} });
  useChatDraftsStore.persist.clearStorage();
}
