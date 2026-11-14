import { create } from "zustand";

export type MakeCardDraft = {
  digest: string;
  heading: string | null;
  page: string | null;
};

/** What "Ask about this" hands to Ask: the digest, the heading it sits under and the selected text. */
export type AskFocus = {
  /** Course-prefixed digest path. */
  digest: string;
  heading: string | null;
  text: string;
};

interface SelectionState {
  askFocus: AskFocus | null;
  setAskFocus: (focus: AskFocus | null) => void;
  selectionText: string;
  heading: string | null;
  page: string | null;
  digest: string | null;
  draft: MakeCardDraft | null;
  setSelection: (input: {
    text: string;
    heading: string | null;
    page: string | null;
    digest: string | null;
  }) => void;
  setDraft: (draft: MakeCardDraft | null) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  askFocus: null,
  setAskFocus: (askFocus) => set({ askFocus }),
  selectionText: "",
  heading: null,
  page: null,
  digest: null,
  draft: null,
  setSelection: (input) =>
    set({
      selectionText: input.text,
      heading: input.heading,
      page: input.page,
      digest: input.digest,
    }),
  setDraft: (draft) => set({ draft }),
  clearSelection: () =>
    set({
      selectionText: "",
      heading: null,
      page: null,
      digest: null,
      draft: null,
      askFocus: null,
    }),
}));
